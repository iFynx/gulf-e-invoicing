/*
 * ZATCA Phase 2 simplified tax invoice engine (browser + Node).
 *
 * Builds a UBL 2.1 simplified invoice, its invoice hash, the XAdES signature
 * block and the 9-tag TLV QR code, the way ZATCA's SDK expects them:
 *  - Invoice hash: SHA-256 of the invoice with ext:UBLExtensions, cac:Signature
 *    and the QR AdditionalDocumentReference removed (C14N 1.1, whitespace kept).
 *    The XML is written already in canonical form, so removing those elements
 *    from the string gives exactly the canonical bytes.
 *  - Signature: ECDSA secp256k1 over SHA-256(invoice hash bytes), DER, base64.
 *  - QR: TLV tags 1-9 (seller, VAT no., timestamp, total, VAT, hash, signature,
 *    public key, certificate signature), base64.
 * Only one VAT category is used: standard rate 15% (S).
 */
import * as secp from '@noble/secp256k1';

export const FIRST_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
export const VAT_RATE = 0.15;

const NS = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"';

const enc = new TextEncoder();

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#xD;');
}

export function r2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function money(n) {
  return r2(n).toFixed(2);
}

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** Line and document totals. lines: [{name, qty, price}] with price excluding VAT. */
export function totals(lines) {
  const rows = lines.map((l, i) => {
    const net = r2(l.qty * l.price);
    const vat = r2(net * VAT_RATE);
    return { id: i + 1, name: l.name, qty: l.qty, price: l.price, net, vat, gross: r2(net + vat) };
  });
  const net = r2(rows.reduce((s, r) => s + r.net, 0));
  const vat = r2(net * VAT_RATE);
  return { rows, net, vat, gross: r2(net + vat) };
}

/** Basic checks that match ZATCA business rules a demo user can break. */
export function validate(inv) {
  const e = [];
  if (!/^3\d{13}3$/.test(inv.seller.vat)) e.push('vat');
  if (!/^\d{4}$/.test(inv.seller.building)) e.push('building');
  if (!/^\d{5}$/.test(inv.seller.postal)) e.push('postal');
  if (!inv.seller.name.trim() || enc.encode(inv.seller.name).length > 200) e.push('name');
  if (!inv.lines.length || inv.lines.some((l) => !l.name.trim() || !(l.qty > 0) || !(l.price >= 0))) e.push('lines');
  return e;
}

function lineXml(r) {
  return [
    '    <cac:InvoiceLine>',
    `        <cbc:ID>${r.id}</cbc:ID>`,
    `        <cbc:InvoicedQuantity unitCode="PCE">${r.qty}</cbc:InvoicedQuantity>`,
    `        <cbc:LineExtensionAmount currencyID="SAR">${money(r.net)}</cbc:LineExtensionAmount>`,
    '        <cac:TaxTotal>',
    `            <cbc:TaxAmount currencyID="SAR">${money(r.vat)}</cbc:TaxAmount>`,
    `            <cbc:RoundingAmount currencyID="SAR">${money(r.gross)}</cbc:RoundingAmount>`,
    '        </cac:TaxTotal>',
    '        <cac:Item>',
    `            <cbc:Name>${esc(r.name)}</cbc:Name>`,
    '            <cac:ClassifiedTaxCategory>',
    '                <cbc:ID>S</cbc:ID>',
    '                <cbc:Percent>15.00</cbc:Percent>',
    '                <cac:TaxScheme>',
    '                    <cbc:ID>VAT</cbc:ID>',
    '                </cac:TaxScheme>',
    '            </cac:ClassifiedTaxCategory>',
    '        </cac:Item>',
    '        <cac:Price>',
    `            <cbc:PriceAmount currencyID="SAR">${money(r.price)}</cbc:PriceAmount>`,
    '        </cac:Price>',
    '    </cac:InvoiceLine>',
  ].join('\n');
}

/**
 * The invoice XML. parts.ext / parts.qr are the signature block and QR text;
 * parts.pure = true leaves out the three elements the invoice hash excludes
 * (keeping their surrounding whitespace, as the XPath transforms do).
 */
export function invoiceXml(inv, t, parts = {}) {
  const s = inv.seller;
  const pure = !!parts.pure;
  const L = [];
  if (!pure) L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push(`<Invoice ${NS}>`);
  L.push(pure ? '    ' : `    <ext:UBLExtensions>${parts.ext || ''}</ext:UBLExtensions>`);
  L.push(
    '    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>',
    `    <cbc:ID>${esc(inv.number)}</cbc:ID>`,
    `    <cbc:UUID>${inv.uuid}</cbc:UUID>`,
    `    <cbc:IssueDate>${inv.date}</cbc:IssueDate>`,
    `    <cbc:IssueTime>${inv.time}</cbc:IssueTime>`,
    '    <cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>',
    '    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>',
    '    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>',
    '    <cac:AdditionalDocumentReference>',
    '        <cbc:ID>ICV</cbc:ID>',
    `        <cbc:UUID>${inv.counter}</cbc:UUID>`,
    '    </cac:AdditionalDocumentReference>',
    '    <cac:AdditionalDocumentReference>',
    '        <cbc:ID>PIH</cbc:ID>',
    '        <cac:Attachment>',
    `            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${inv.pih}</cbc:EmbeddedDocumentBinaryObject>`,
    '        </cac:Attachment>',
    '    </cac:AdditionalDocumentReference>'
  );
  L.push(pure ? '    ' : [
    '    <cac:AdditionalDocumentReference>',
    '        <cbc:ID>QR</cbc:ID>',
    '        <cac:Attachment>',
    `            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${parts.qr || ''}</cbc:EmbeddedDocumentBinaryObject>`,
    '        </cac:Attachment>',
    '    </cac:AdditionalDocumentReference>',
  ].join('\n'));
  L.push(pure ? '    ' : [
    '    <cac:Signature>',
    '        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>',
    '        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>',
    '    </cac:Signature>',
  ].join('\n'));
  L.push(
    '    <cac:AccountingSupplierParty>',
    '        <cac:Party>',
    '            <cac:PartyIdentification>',
    `                <cbc:ID schemeID="CRN">${esc(s.crn)}</cbc:ID>`,
    '            </cac:PartyIdentification>',
    '            <cac:PostalAddress>',
    `                <cbc:StreetName>${esc(s.street)}</cbc:StreetName>`,
    `                <cbc:BuildingNumber>${esc(s.building)}</cbc:BuildingNumber>`,
    `                <cbc:CitySubdivisionName>${esc(s.district)}</cbc:CitySubdivisionName>`,
    `                <cbc:CityName>${esc(s.city)}</cbc:CityName>`,
    `                <cbc:PostalZone>${esc(s.postal)}</cbc:PostalZone>`,
    '                <cac:Country>',
    '                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>',
    '                </cac:Country>',
    '            </cac:PostalAddress>',
    '            <cac:PartyTaxScheme>',
    `                <cbc:CompanyID>${esc(s.vat)}</cbc:CompanyID>`,
    '                <cac:TaxScheme>',
    '                    <cbc:ID>VAT</cbc:ID>',
    '                </cac:TaxScheme>',
    '            </cac:PartyTaxScheme>',
    '            <cac:PartyLegalEntity>',
    `                <cbc:RegistrationName>${esc(s.name)}</cbc:RegistrationName>`,
    '            </cac:PartyLegalEntity>',
    '        </cac:Party>',
    '    </cac:AccountingSupplierParty>',
    '    <cac:AccountingCustomerParty>',
    '        <cac:Party>',
    '            <cac:PartyLegalEntity>',
    `                <cbc:RegistrationName>${esc(inv.buyer || 'Walk-in customer')}</cbc:RegistrationName>`,
    '            </cac:PartyLegalEntity>',
    '        </cac:Party>',
    '    </cac:AccountingCustomerParty>',
    '    <cac:PaymentMeans>',
    `        <cbc:PaymentMeansCode>${inv.payment || '10'}</cbc:PaymentMeansCode>`,
    '    </cac:PaymentMeans>',
    '    <cac:TaxTotal>',
    `        <cbc:TaxAmount currencyID="SAR">${money(t.vat)}</cbc:TaxAmount>`,
    '    </cac:TaxTotal>',
    '    <cac:TaxTotal>',
    `        <cbc:TaxAmount currencyID="SAR">${money(t.vat)}</cbc:TaxAmount>`,
    '        <cac:TaxSubtotal>',
    `            <cbc:TaxableAmount currencyID="SAR">${money(t.net)}</cbc:TaxableAmount>`,
    `            <cbc:TaxAmount currencyID="SAR">${money(t.vat)}</cbc:TaxAmount>`,
    '            <cac:TaxCategory>',
    '                <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID>',
    '                <cbc:Percent>15.00</cbc:Percent>',
    '                <cac:TaxScheme>',
    '                    <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>',
    '                </cac:TaxScheme>',
    '            </cac:TaxCategory>',
    '        </cac:TaxSubtotal>',
    '    </cac:TaxTotal>',
    '    <cac:LegalMonetaryTotal>',
    `        <cbc:LineExtensionAmount currencyID="SAR">${money(t.net)}</cbc:LineExtensionAmount>`,
    `        <cbc:TaxExclusiveAmount currencyID="SAR">${money(t.net)}</cbc:TaxExclusiveAmount>`,
    `        <cbc:TaxInclusiveAmount currencyID="SAR">${money(t.gross)}</cbc:TaxInclusiveAmount>`,
    '        <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>',
    '        <cbc:PrepaidAmount currencyID="SAR">0.00</cbc:PrepaidAmount>',
    `        <cbc:PayableAmount currencyID="SAR">${money(t.gross)}</cbc:PayableAmount>`,
    '    </cac:LegalMonetaryTotal>'
  );
  t.rows.forEach((r) => L.push(lineXml(r)));
  L.push('</Invoice>');
  return L.join('\n');
}

function tlv(values) {
  const parts = values.map((v, i) => {
    const bytes = typeof v === 'string' ? enc.encode(v) : v;
    if (bytes.length > 255) throw new Error('QR tag ' + (i + 1) + ' too long');
    const out = new Uint8Array(bytes.length + 2);
    out[0] = i + 1;
    out[1] = bytes.length;
    out.set(bytes, 2);
    return out;
  });
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  parts.forEach((p) => { all.set(p, o); o += p.length; });
  return all;
}

/** Decodes a TLV QR payload (base64) into [{tag, text|bytes}] for display. */
export function readQr(qrB64) {
  const b = unb64(qrB64);
  const out = [];
  for (let i = 0; i + 1 < b.length;) {
    const tag = b[i], len = b[i + 1];
    out.push({ tag, bytes: b.slice(i + 2, i + 2 + len) });
    i += 2 + len;
  }
  return out;
}

/** 64-byte compact (r||s) ECDSA signature -> DER SEQUENCE { INTEGER r, INTEGER s }. */
function derSignature(c) {
  const int = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    b = b.slice(i);
    if (b[0] & 0x80) { const p = new Uint8Array(b.length + 1); p.set(b, 1); b = p; }
    const o = new Uint8Array(b.length + 2); o[0] = 2; o[1] = b.length; o.set(b, 2); return o;
  };
  const r = int(c.slice(0, 32)), s = int(c.slice(32));
  const out = new Uint8Array(2 + r.length + s.length);
  out[0] = 0x30; out[1] = r.length + s.length; out.set(r, 2); out.set(s, 2 + r.length);
  return out;
}

export function signedProps(time, cert, forSigning) {
  if (forSigning) {
    // Hashed form (what ZATCA's SDK digests): ds namespace on each ds element,
    // first line unindented, the rest under a 32-space prefix.
    const p = ' '.repeat(32);
    return '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">\n' + [
      '    <xades:SignedSignatureProperties>',
      `        <xades:SigningTime>${time}</xades:SigningTime>`,
      '        <xades:SigningCertificate>',
      '            <xades:Cert>',
      '                <xades:CertDigest>',
      '                    <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
      `                    <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${cert.hash}</ds:DigestValue>`,
      '                </xades:CertDigest>',
      '                <xades:IssuerSerial>',
      `                    <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${esc(cert.issuer)}</ds:X509IssuerName>`,
      `                    <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${cert.serial}</ds:X509SerialNumber>`,
      '                </xades:IssuerSerial>',
      '            </xades:Cert>',
      '        </xades:SigningCertificate>',
      '    </xades:SignedSignatureProperties>',
      '</xades:SignedProperties>',
    ].map((l) => p + l).join('\n');
  }
  const p = ' '.repeat(32);
  return [
    '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">',
    '    <xades:SignedSignatureProperties>',
    `        <xades:SigningTime>${time}</xades:SigningTime>`,
    '        <xades:SigningCertificate>',
    '            <xades:Cert>',
    '                <xades:CertDigest>',
    '                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>',
    `                    <ds:DigestValue>${cert.hash}</ds:DigestValue>`,
    '                </xades:CertDigest>',
    '                <xades:IssuerSerial>',
    `                    <ds:X509IssuerName>${esc(cert.issuer)}</ds:X509IssuerName>`,
    `                    <ds:X509SerialNumber>${cert.serial}</ds:X509SerialNumber>`,
    '                </xades:IssuerSerial>',
    '            </xades:Cert>',
    '        </xades:SigningCertificate>',
    '    </xades:SignedSignatureProperties>',
    '</xades:SignedProperties>',
  ].map((l) => p + l).join('\n');
}

function extXml(invoiceHash, propsHash, signature, cert, props) {
  const X = 'http://www.w3.org/TR/1999/REC-xpath-19991116';
  return '\n' + [
    '        <ext:UBLExtension>',
    '            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>',
    '            <ext:ExtensionContent>',
    '                <sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">',
    '                    <sac:SignatureInformation>',
    '                        <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>',
    '                        <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>',
    '                        <ds:Signature Id="signature" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
    '                            <ds:SignedInfo>',
    '                                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod>',
    '                                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>',
    '                                <ds:Reference Id="invoiceSignedData" URI="">',
    '                                    <ds:Transforms>',
    `                                        <ds:Transform Algorithm="${X}">`,
    '                                            <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>',
    '                                        </ds:Transform>',
    `                                        <ds:Transform Algorithm="${X}">`,
    '                                            <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>',
    '                                        </ds:Transform>',
    `                                        <ds:Transform Algorithm="${X}">`,
    "                                            <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>",
    '                                        </ds:Transform>',
    '                                        <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform>',
    '                                    </ds:Transforms>',
    '                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>',
    `                                    <ds:DigestValue>${invoiceHash}</ds:DigestValue>`,
    '                                </ds:Reference>',
    '                                <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">',
    '                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>',
    `                                    <ds:DigestValue>${propsHash}</ds:DigestValue>`,
    '                                </ds:Reference>',
    '                            </ds:SignedInfo>',
    `                            <ds:SignatureValue>${signature}</ds:SignatureValue>`,
    '                            <ds:KeyInfo>',
    '                                <ds:X509Data>',
    `                                    <ds:X509Certificate>${cert.b64}</ds:X509Certificate>`,
    '                                </ds:X509Data>',
    '                            </ds:KeyInfo>',
    '                            <ds:Object>',
    '                            <xades:QualifyingProperties Target="signature" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">',
    props,
    '                            </xades:QualifyingProperties>',
    '                            </ds:Object>',
    '                        </ds:Signature>',
    '                    </sac:SignatureInformation>',
    '                </sig:UBLDocumentSignatures>',
    '            </ext:ExtensionContent>',
    '        </ext:UBLExtension>',
  ].join('\n') + '\n    ';
}

/**
 * Signs an invoice. key: 32-byte private key (Uint8Array); cert: {b64, hash,
 * issuer, serial, publicKey (base64 SPKI DER), signature (base64 DER)}.
 * Returns every intermediate value so the demo can show each step.
 */
export async function signInvoice(inv, key, cert, now = new Date()) {
  const t = totals(inv.lines);
  const pure = invoiceXml(inv, t, { pure: true });
  const hashBytes = await sha256(pure);
  const invoiceHash = b64(hashBytes);

  const sig = await secp.signAsync(await sha256(hashBytes), key);
  const signature = b64(derSignature(sig.toCompactRawBytes()));

  const time = now.toISOString().slice(0, 19) + 'Z';
  const propsHash = btoa(hex(await sha256(signedProps(time, cert, true))));

  const qrBytes = tlv([
    inv.seller.name,
    inv.seller.vat,
    `${inv.date}T${inv.time}`,
    money(t.gross),
    money(t.vat),
    invoiceHash,
    signature,
    unb64(cert.publicKey),
    unb64(cert.signature),
  ]);
  const qr = b64(qrBytes);
  const ext = extXml(invoiceHash, propsHash, signature, cert, signedProps(time, cert, false));
  const xml = invoiceXml(inv, t, { ext, qr });
  return { xml, invoiceHash, signature, propsHash, qr, totals: t, signingTime: time };
}
