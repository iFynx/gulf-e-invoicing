"""ZATCA Phase 2 simplified tax invoice engine.

Builds a UBL 2.1 simplified invoice, its invoice hash, the XAdES signature
block and the 9-tag TLV QR code, the way ZATCA's SDK expects them:

* Invoice hash: SHA-256 of the invoice with ``ext:UBLExtensions``,
  ``cac:Signature`` and the QR ``AdditionalDocumentReference`` removed
  (C14N 1.1, whitespace kept). The XML is written already in canonical form,
  so removing those elements from the string gives exactly the canonical bytes.
* Signature: ECDSA secp256k1 over SHA-256(invoice hash bytes), DER, base64.
  RFC 6979 deterministic nonces with low-S, so output is reproducible.
* QR: TLV tags 1-9 (seller, VAT number, timestamp, total, VAT, hash,
  signature, public key, certificate signature), base64.

Output is byte-for-byte identical to the JavaScript engine in ``zatca/``.
"""
from __future__ import annotations

import base64
import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature

from ._num import js_num, money, r2

__all__ = [
    "FIRST_PIH", "VAT_RATE", "Certificate", "Signed", "totals", "validate", "invoice_xml",
    "sign_invoice", "read_qr", "signed_props", "cert_info", "load_private_key",
]

FIRST_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=="
VAT_RATE = 0.15

_NS = ('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" '
       'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" '
       'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" '
       'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"')
_SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141


def _esc(s: Any) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("\r", "&#xD;"))


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


@dataclass(frozen=True)
class Certificate:
    """Values the engine needs from an X.509 (CSID) certificate."""
    b64: str
    hash: str
    issuer: str
    serial: str
    public_key: str
    signature: str


@dataclass(frozen=True)
class Signed:
    xml: str
    invoice_hash: str
    signature: str
    props_hash: str
    qr: str
    totals: dict
    signing_time: str


def totals(lines: Sequence[Mapping[str, Any]]) -> dict:
    """Line and document totals. ``lines``: ``[{name, qty, price}]``, price excluding VAT."""
    rows = []
    for i, line in enumerate(lines):
        net = r2(line["qty"] * line["price"])
        vat = r2(net * VAT_RATE)
        rows.append({"id": i + 1, "name": line["name"], "qty": line["qty"], "price": line["price"],
                     "net": net, "vat": vat, "gross": r2(net + vat)})
    net = 0.0
    for row in rows:
        net += row["net"]
    net = r2(net)
    vat = r2(net * VAT_RATE)
    return {"rows": rows, "net": net, "vat": vat, "gross": r2(net + vat)}


def validate(inv: Mapping[str, Any]) -> list[str]:
    """Field codes that break basic ZATCA rules: vat, building, postal, name, lines."""
    s, e = inv["seller"], []
    if not re.fullmatch(r"3\d{13}3", s["vat"]):
        e.append("vat")
    if not re.fullmatch(r"\d{4}", s["building"]):
        e.append("building")
    if not re.fullmatch(r"\d{5}", s["postal"]):
        e.append("postal")
    if not s["name"].strip() or len(s["name"].encode()) > 200:
        e.append("name")
    lines = inv["lines"]
    if not lines or any(not l["name"].strip() or not l["qty"] > 0 or not l["price"] >= 0 for l in lines):
        e.append("lines")
    return e


def _line_xml(r: Mapping[str, Any]) -> str:
    return "\n".join([
        "    <cac:InvoiceLine>",
        f"        <cbc:ID>{r['id']}</cbc:ID>",
        f'        <cbc:InvoicedQuantity unitCode="PCE">{js_num(r["qty"])}</cbc:InvoicedQuantity>',
        f'        <cbc:LineExtensionAmount currencyID="SAR">{money(r["net"])}</cbc:LineExtensionAmount>',
        "        <cac:TaxTotal>",
        f'            <cbc:TaxAmount currencyID="SAR">{money(r["vat"])}</cbc:TaxAmount>',
        f'            <cbc:RoundingAmount currencyID="SAR">{money(r["gross"])}</cbc:RoundingAmount>',
        "        </cac:TaxTotal>",
        "        <cac:Item>",
        f"            <cbc:Name>{_esc(r['name'])}</cbc:Name>",
        "            <cac:ClassifiedTaxCategory>",
        "                <cbc:ID>S</cbc:ID>",
        "                <cbc:Percent>15.00</cbc:Percent>",
        "                <cac:TaxScheme>",
        "                    <cbc:ID>VAT</cbc:ID>",
        "                </cac:TaxScheme>",
        "            </cac:ClassifiedTaxCategory>",
        "        </cac:Item>",
        "        <cac:Price>",
        f'            <cbc:PriceAmount currencyID="SAR">{money(r["price"])}</cbc:PriceAmount>',
        "        </cac:Price>",
        "    </cac:InvoiceLine>",
    ])


def invoice_xml(inv: Mapping[str, Any], t: Mapping[str, Any] | None = None, *, ext: str = "",
                qr: str = "", pure: bool = False) -> str:
    """The invoice XML. ``pure=True`` gives the exact bytes that are hashed."""
    t = t or totals(inv["lines"])
    s = inv["seller"]
    out: list[str] = []
    if not pure:
        out.append('<?xml version="1.0" encoding="UTF-8"?>')
    out.append(f"<Invoice {_NS}>")
    out.append("    " if pure else f"    <ext:UBLExtensions>{ext}</ext:UBLExtensions>")
    out += [
        "    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>",
        f"    <cbc:ID>{_esc(inv['number'])}</cbc:ID>",
        f"    <cbc:UUID>{inv['uuid']}</cbc:UUID>",
        f"    <cbc:IssueDate>{inv['date']}</cbc:IssueDate>",
        f"    <cbc:IssueTime>{inv['time']}</cbc:IssueTime>",
        '    <cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>',
        "    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>",
        "    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>",
        "    <cac:AdditionalDocumentReference>",
        "        <cbc:ID>ICV</cbc:ID>",
        f"        <cbc:UUID>{inv['counter']}</cbc:UUID>",
        "    </cac:AdditionalDocumentReference>",
        "    <cac:AdditionalDocumentReference>",
        "        <cbc:ID>PIH</cbc:ID>",
        "        <cac:Attachment>",
        f'            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">{inv["pih"]}</cbc:EmbeddedDocumentBinaryObject>',
        "        </cac:Attachment>",
        "    </cac:AdditionalDocumentReference>",
    ]
    out.append("    " if pure else "\n".join([
        "    <cac:AdditionalDocumentReference>",
        "        <cbc:ID>QR</cbc:ID>",
        "        <cac:Attachment>",
        f'            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">{qr}</cbc:EmbeddedDocumentBinaryObject>',
        "        </cac:Attachment>",
        "    </cac:AdditionalDocumentReference>",
    ]))
    out.append("    " if pure else "\n".join([
        "    <cac:Signature>",
        "        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>",
        "        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>",
        "    </cac:Signature>",
    ]))
    out += [
        "    <cac:AccountingSupplierParty>",
        "        <cac:Party>",
        "            <cac:PartyIdentification>",
        f'                <cbc:ID schemeID="CRN">{_esc(s["crn"])}</cbc:ID>',
        "            </cac:PartyIdentification>",
        "            <cac:PostalAddress>",
        f"                <cbc:StreetName>{_esc(s['street'])}</cbc:StreetName>",
        f"                <cbc:BuildingNumber>{_esc(s['building'])}</cbc:BuildingNumber>",
        f"                <cbc:CitySubdivisionName>{_esc(s['district'])}</cbc:CitySubdivisionName>",
        f"                <cbc:CityName>{_esc(s['city'])}</cbc:CityName>",
        f"                <cbc:PostalZone>{_esc(s['postal'])}</cbc:PostalZone>",
        "                <cac:Country>",
        "                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>",
        "                </cac:Country>",
        "            </cac:PostalAddress>",
        "            <cac:PartyTaxScheme>",
        f"                <cbc:CompanyID>{_esc(s['vat'])}</cbc:CompanyID>",
        "                <cac:TaxScheme>",
        "                    <cbc:ID>VAT</cbc:ID>",
        "                </cac:TaxScheme>",
        "            </cac:PartyTaxScheme>",
        "            <cac:PartyLegalEntity>",
        f"                <cbc:RegistrationName>{_esc(s['name'])}</cbc:RegistrationName>",
        "            </cac:PartyLegalEntity>",
        "        </cac:Party>",
        "    </cac:AccountingSupplierParty>",
        "    <cac:AccountingCustomerParty>",
        "        <cac:Party>",
        "            <cac:PartyLegalEntity>",
        f"                <cbc:RegistrationName>{_esc(inv.get('buyer') or 'Walk-in customer')}</cbc:RegistrationName>",
        "            </cac:PartyLegalEntity>",
        "        </cac:Party>",
        "    </cac:AccountingCustomerParty>",
        "    <cac:PaymentMeans>",
        f"        <cbc:PaymentMeansCode>{inv.get('payment') or '10'}</cbc:PaymentMeansCode>",
        "    </cac:PaymentMeans>",
        "    <cac:TaxTotal>",
        f'        <cbc:TaxAmount currencyID="SAR">{money(t["vat"])}</cbc:TaxAmount>',
        "    </cac:TaxTotal>",
        "    <cac:TaxTotal>",
        f'        <cbc:TaxAmount currencyID="SAR">{money(t["vat"])}</cbc:TaxAmount>',
        "        <cac:TaxSubtotal>",
        f'            <cbc:TaxableAmount currencyID="SAR">{money(t["net"])}</cbc:TaxableAmount>',
        f'            <cbc:TaxAmount currencyID="SAR">{money(t["vat"])}</cbc:TaxAmount>',
        "            <cac:TaxCategory>",
        '                <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID>',
        "                <cbc:Percent>15.00</cbc:Percent>",
        "                <cac:TaxScheme>",
        '                    <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>',
        "                </cac:TaxScheme>",
        "            </cac:TaxCategory>",
        "        </cac:TaxSubtotal>",
        "    </cac:TaxTotal>",
        "    <cac:LegalMonetaryTotal>",
        f'        <cbc:LineExtensionAmount currencyID="SAR">{money(t["net"])}</cbc:LineExtensionAmount>',
        f'        <cbc:TaxExclusiveAmount currencyID="SAR">{money(t["net"])}</cbc:TaxExclusiveAmount>',
        f'        <cbc:TaxInclusiveAmount currencyID="SAR">{money(t["gross"])}</cbc:TaxInclusiveAmount>',
        '        <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>',
        '        <cbc:PrepaidAmount currencyID="SAR">0.00</cbc:PrepaidAmount>',
        f'        <cbc:PayableAmount currencyID="SAR">{money(t["gross"])}</cbc:PayableAmount>',
        "    </cac:LegalMonetaryTotal>",
    ]
    out += [_line_xml(r) for r in t["rows"]]
    out.append("</Invoice>")
    return "\n".join(out)


def _tlv(values: Sequence[str | bytes]) -> bytes:
    buf = bytearray()
    for i, v in enumerate(values):
        b = v.encode() if isinstance(v, str) else bytes(v)
        if len(b) > 255:
            raise ValueError(f"QR tag {i + 1} too long")
        buf += bytes([i + 1, len(b)]) + b
    return bytes(buf)


def read_qr(qr_b64: str) -> list[dict]:
    """Decode a base64 TLV QR payload into ``[{tag, bytes}]``."""
    b, out, i = base64.b64decode(qr_b64), [], 0
    while i + 1 < len(b):
        tag, length = b[i], b[i + 1]
        out.append({"tag": tag, "bytes": b[i + 2:i + 2 + length]})
        i += 2 + length
    return out


def signed_props(time: str, cert: Certificate, for_signing: bool) -> str:
    """XAdES SignedProperties: the hashed form or the form embedded in the XML."""
    p = " " * 32
    if for_signing:
        ds = ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"'
        body = [
            "    <xades:SignedSignatureProperties>",
            f"        <xades:SigningTime>{time}</xades:SigningTime>",
            "        <xades:SigningCertificate>",
            "            <xades:Cert>",
            "                <xades:CertDigest>",
            f'                    <ds:DigestMethod{ds} Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
            f"                    <ds:DigestValue{ds}>{cert.hash}</ds:DigestValue>",
            "                </xades:CertDigest>",
            "                <xades:IssuerSerial>",
            f"                    <ds:X509IssuerName{ds}>{_esc(cert.issuer)}</ds:X509IssuerName>",
            f"                    <ds:X509SerialNumber{ds}>{cert.serial}</ds:X509SerialNumber>",
            "                </xades:IssuerSerial>",
            "            </xades:Cert>",
            "        </xades:SigningCertificate>",
            "    </xades:SignedSignatureProperties>",
            "</xades:SignedProperties>",
        ]
        head = '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">\n'
        return head + "\n".join(p + l for l in body)
    body = [
        '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">',
        "    <xades:SignedSignatureProperties>",
        f"        <xades:SigningTime>{time}</xades:SigningTime>",
        "        <xades:SigningCertificate>",
        "            <xades:Cert>",
        "                <xades:CertDigest>",
        '                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>',
        f"                    <ds:DigestValue>{cert.hash}</ds:DigestValue>",
        "                </xades:CertDigest>",
        "                <xades:IssuerSerial>",
        f"                    <ds:X509IssuerName>{_esc(cert.issuer)}</ds:X509IssuerName>",
        f"                    <ds:X509SerialNumber>{cert.serial}</ds:X509SerialNumber>",
        "                </xades:IssuerSerial>",
        "            </xades:Cert>",
        "        </xades:SigningCertificate>",
        "    </xades:SignedSignatureProperties>",
        "</xades:SignedProperties>",
    ]
    return "\n".join(p + l for l in body)


def _ext_xml(invoice_hash: str, props_hash: str, signature: str, cert: Certificate, props: str) -> str:
    x = "http://www.w3.org/TR/1999/REC-xpath-19991116"
    lines = [
        "        <ext:UBLExtension>",
        "            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>",
        "            <ext:ExtensionContent>",
        '                <sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">',
        "                    <sac:SignatureInformation>",
        "                        <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>",
        "                        <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>",
        '                        <ds:Signature Id="signature" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
        "                            <ds:SignedInfo>",
        '                                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod>',
        '                                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>',
        '                                <ds:Reference Id="invoiceSignedData" URI="">',
        "                                    <ds:Transforms>",
        f'                                        <ds:Transform Algorithm="{x}">',
        "                                            <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>",
        "                                        </ds:Transform>",
        f'                                        <ds:Transform Algorithm="{x}">',
        "                                            <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>",
        "                                        </ds:Transform>",
        f'                                        <ds:Transform Algorithm="{x}">',
        "                                            <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>",
        "                                        </ds:Transform>",
        '                                        <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform>',
        "                                    </ds:Transforms>",
        '                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>',
        f"                                    <ds:DigestValue>{invoice_hash}</ds:DigestValue>",
        "                                </ds:Reference>",
        '                                <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">',
        '                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>',
        f"                                    <ds:DigestValue>{props_hash}</ds:DigestValue>",
        "                                </ds:Reference>",
        "                            </ds:SignedInfo>",
        f"                            <ds:SignatureValue>{signature}</ds:SignatureValue>",
        "                            <ds:KeyInfo>",
        "                                <ds:X509Data>",
        f"                                    <ds:X509Certificate>{cert.b64}</ds:X509Certificate>",
        "                                </ds:X509Data>",
        "                            </ds:KeyInfo>",
        "                            <ds:Object>",
        '                            <xades:QualifyingProperties Target="signature" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">',
        props,
        "                            </xades:QualifyingProperties>",
        "                            </ds:Object>",
        "                        </ds:Signature>",
        "                    </sac:SignatureInformation>",
        "                </sig:UBLDocumentSignatures>",
        "            </ext:ExtensionContent>",
        "        </ext:UBLExtension>",
    ]
    return "\n" + "\n".join(lines) + "\n    "


def _sign(key: ec.EllipticCurvePrivateKey, data: bytes) -> bytes:
    der = key.sign(data, ec.ECDSA(hashes.SHA256(), deterministic_signing=True))
    r, s = decode_dss_signature(der)
    if s > _SECP256K1_N // 2:  # low-S, as libsecp256k1 / noble produce
        s = _SECP256K1_N - s
    return encode_dss_signature(r, s)


def sign_invoice(inv: Mapping[str, Any], key: ec.EllipticCurvePrivateKey, cert: Certificate,
                 now: datetime | None = None) -> Signed:
    """Sign a simplified invoice. ``key`` is a secp256k1 private key (see :func:`load_private_key`)."""
    t = totals(inv["lines"])
    pure = invoice_xml(inv, t, pure=True)
    hash_bytes = hashlib.sha256(pure.encode()).digest()
    invoice_hash = _b64(hash_bytes)
    signature = _b64(_sign(key, hash_bytes))
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    time = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    props_hash = _b64(hashlib.sha256(signed_props(time, cert, True).encode()).hexdigest().encode())
    qr = _b64(_tlv([
        inv["seller"]["name"], inv["seller"]["vat"], f"{inv['date']}T{inv['time']}",
        money(t["gross"]), money(t["vat"]), invoice_hash, signature,
        base64.b64decode(cert.public_key), base64.b64decode(cert.signature),
    ]))
    ext = _ext_xml(invoice_hash, props_hash, signature, cert, signed_props(time, cert, False))
    return Signed(invoice_xml(inv, t, ext=ext, qr=qr), invoice_hash, signature, props_hash, qr, t, time)


def cert_info(cert_b64: str) -> Certificate:
    """Read a CSID certificate (base64 DER body, no PEM header)."""
    b64 = re.sub(r"-----[^-]+-----|\s+", "", cert_b64)
    c = x509.load_der_x509_certificate(base64.b64decode(b64))
    issuer = ", ".join(rdn.rfc4514_string() for rdn in reversed(c.issuer.rdns))
    spki = c.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return Certificate(
        b64=b64,
        hash=_b64(hashlib.sha256(b64.encode()).hexdigest().encode()),
        issuer=issuer,
        serial=str(c.serial_number),
        public_key=_b64(spki),
        signature=_b64(c.signature),
    )


def load_private_key(pem: str | bytes) -> ec.EllipticCurvePrivateKey:
    """Load an EC (secp256k1) private key from PEM."""
    key = serialization.load_pem_private_key(pem.encode() if isinstance(pem, str) else pem, password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey) or key.curve.name != "secp256k1":
        raise ValueError("ZATCA requires a secp256k1 EC private key")
    return key
