<?php

declare(strict_types=1);

namespace IFynx\GulfEInvoicing\Zatca;

use IFynx\GulfEInvoicing\Num;

/**
 * ZATCA Phase 2 simplified tax invoice engine.
 *
 * Builds a UBL 2.1 simplified invoice, its invoice hash, the XAdES signature
 * block and the 9-tag TLV QR code, the way ZATCA's SDK expects them. The XML
 * is written already in canonical form, so the hashed bytes are exact.
 * Output matches the JavaScript and Python engines byte-for-byte (the ECDSA
 * signature value itself uses OpenSSL's random nonce, so it differs per run
 * but verifies with the same key).
 */
final class Invoice
{
    public const FIRST_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
    public const VAT_RATE = 0.15;

    private const NS = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"';

    public static function esc(mixed $s): string
    {
        return str_replace(['&', '<', '>', '"', "\r"], ['&amp;', '&lt;', '&gt;', '&quot;', '&#xD;'], (string) $s);
    }

    /**
     * Line and document totals. $lines: [['name'=>, 'qty'=>, 'price'=>]], price excluding VAT.
     *
     * @param list<array{name:string,qty:int|float,price:int|float}> $lines
     * @return array{rows:list<array<string,mixed>>,net:float,vat:float,gross:float}
     */
    public static function totals(array $lines): array
    {
        $rows = [];
        $net = 0.0;
        foreach (array_values($lines) as $i => $l) {
            $n = Num::r2($l['qty'] * $l['price']);
            $v = Num::r2($n * self::VAT_RATE);
            $rows[] = ['id' => $i + 1, 'name' => $l['name'], 'qty' => $l['qty'], 'price' => $l['price'], 'net' => $n, 'vat' => $v, 'gross' => Num::r2($n + $v)];
            $net += $n;
        }
        $net = Num::r2($net);
        $vat = Num::r2($net * self::VAT_RATE);
        return ['rows' => $rows, 'net' => $net, 'vat' => $vat, 'gross' => Num::r2($net + $vat)];
    }

    /**
     * Field codes that break basic ZATCA rules: vat, building, postal, name, lines.
     *
     * @param array<string,mixed> $inv
     * @return list<string>
     */
    public static function validate(array $inv): array
    {
        $s = $inv['seller'];
        $e = [];
        if (!preg_match('/^3\d{13}3$/D', (string) $s['vat'])) {
            $e[] = 'vat';
        }
        if (!preg_match('/^\d{4}$/D', (string) $s['building'])) {
            $e[] = 'building';
        }
        if (!preg_match('/^\d{5}$/D', (string) $s['postal'])) {
            $e[] = 'postal';
        }
        if (trim((string) $s['name']) === '' || strlen((string) $s['name']) > 200) {
            $e[] = 'name';
        }
        $bad = $inv['lines'] === [];
        foreach ($inv['lines'] as $l) {
            if (trim((string) $l['name']) === '' || !($l['qty'] > 0) || !($l['price'] >= 0)) {
                $bad = true;
            }
        }
        if ($bad) {
            $e[] = 'lines';
        }
        return $e;
    }

    /** @param array<string,mixed> $r */
    private static function lineXml(array $r): string
    {
        $m = [Num::class, 'money'];
        return implode("\n", [
            '    <cac:InvoiceLine>',
            "        <cbc:ID>{$r['id']}</cbc:ID>",
            '        <cbc:InvoicedQuantity unitCode="PCE">' . Num::js($r['qty']) . '</cbc:InvoicedQuantity>',
            '        <cbc:LineExtensionAmount currencyID="SAR">' . $m($r['net']) . '</cbc:LineExtensionAmount>',
            '        <cac:TaxTotal>',
            '            <cbc:TaxAmount currencyID="SAR">' . $m($r['vat']) . '</cbc:TaxAmount>',
            '            <cbc:RoundingAmount currencyID="SAR">' . $m($r['gross']) . '</cbc:RoundingAmount>',
            '        </cac:TaxTotal>',
            '        <cac:Item>',
            '            <cbc:Name>' . self::esc($r['name']) . '</cbc:Name>',
            '            <cac:ClassifiedTaxCategory>',
            '                <cbc:ID>S</cbc:ID>',
            '                <cbc:Percent>15.00</cbc:Percent>',
            '                <cac:TaxScheme>',
            '                    <cbc:ID>VAT</cbc:ID>',
            '                </cac:TaxScheme>',
            '            </cac:ClassifiedTaxCategory>',
            '        </cac:Item>',
            '        <cac:Price>',
            '            <cbc:PriceAmount currencyID="SAR">' . $m($r['price']) . '</cbc:PriceAmount>',
            '        </cac:Price>',
            '    </cac:InvoiceLine>',
        ]);
    }

    /**
     * The invoice XML. $pure = true gives the exact bytes that are hashed.
     *
     * @param array<string,mixed> $inv
     * @param array<string,mixed>|null $t
     */
    public static function xml(array $inv, ?array $t = null, string $ext = '', string $qr = '', bool $pure = false): string
    {
        $t ??= self::totals($inv['lines']);
        $s = $inv['seller'];
        $e = [self::class, 'esc'];
        $m = [Num::class, 'money'];
        $L = [];
        if (!$pure) {
            $L[] = '<?xml version="1.0" encoding="UTF-8"?>';
        }
        $L[] = '<Invoice ' . self::NS . '>';
        $L[] = $pure ? '    ' : "    <ext:UBLExtensions>{$ext}</ext:UBLExtensions>";
        array_push(
            $L,
            '    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>',
            '    <cbc:ID>' . $e($inv['number']) . '</cbc:ID>',
            "    <cbc:UUID>{$inv['uuid']}</cbc:UUID>",
            "    <cbc:IssueDate>{$inv['date']}</cbc:IssueDate>",
            "    <cbc:IssueTime>{$inv['time']}</cbc:IssueTime>",
            '    <cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>',
            '    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>',
            '    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>',
            '    <cac:AdditionalDocumentReference>',
            '        <cbc:ID>ICV</cbc:ID>',
            "        <cbc:UUID>{$inv['counter']}</cbc:UUID>",
            '    </cac:AdditionalDocumentReference>',
            '    <cac:AdditionalDocumentReference>',
            '        <cbc:ID>PIH</cbc:ID>',
            '        <cac:Attachment>',
            "            <cbc:EmbeddedDocumentBinaryObject mimeCode=\"text/plain\">{$inv['pih']}</cbc:EmbeddedDocumentBinaryObject>",
            '        </cac:Attachment>',
            '    </cac:AdditionalDocumentReference>',
        );
        $L[] = $pure ? '    ' : implode("\n", [
            '    <cac:AdditionalDocumentReference>',
            '        <cbc:ID>QR</cbc:ID>',
            '        <cac:Attachment>',
            "            <cbc:EmbeddedDocumentBinaryObject mimeCode=\"text/plain\">{$qr}</cbc:EmbeddedDocumentBinaryObject>",
            '        </cac:Attachment>',
            '    </cac:AdditionalDocumentReference>',
        ]);
        $L[] = $pure ? '    ' : implode("\n", [
            '    <cac:Signature>',
            '        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>',
            '        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>',
            '    </cac:Signature>',
        ]);
        $buyer = ($inv['buyer'] ?? '') !== '' && ($inv['buyer'] ?? null) !== null ? $inv['buyer'] : 'Walk-in customer';
        $payment = ($inv['payment'] ?? '') !== '' && ($inv['payment'] ?? null) !== null ? $inv['payment'] : '10';
        array_push(
            $L,
            '    <cac:AccountingSupplierParty>',
            '        <cac:Party>',
            '            <cac:PartyIdentification>',
            '                <cbc:ID schemeID="CRN">' . $e($s['crn']) . '</cbc:ID>',
            '            </cac:PartyIdentification>',
            '            <cac:PostalAddress>',
            '                <cbc:StreetName>' . $e($s['street']) . '</cbc:StreetName>',
            '                <cbc:BuildingNumber>' . $e($s['building']) . '</cbc:BuildingNumber>',
            '                <cbc:CitySubdivisionName>' . $e($s['district']) . '</cbc:CitySubdivisionName>',
            '                <cbc:CityName>' . $e($s['city']) . '</cbc:CityName>',
            '                <cbc:PostalZone>' . $e($s['postal']) . '</cbc:PostalZone>',
            '                <cac:Country>',
            '                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>',
            '                </cac:Country>',
            '            </cac:PostalAddress>',
            '            <cac:PartyTaxScheme>',
            '                <cbc:CompanyID>' . $e($s['vat']) . '</cbc:CompanyID>',
            '                <cac:TaxScheme>',
            '                    <cbc:ID>VAT</cbc:ID>',
            '                </cac:TaxScheme>',
            '            </cac:PartyTaxScheme>',
            '            <cac:PartyLegalEntity>',
            '                <cbc:RegistrationName>' . $e($s['name']) . '</cbc:RegistrationName>',
            '            </cac:PartyLegalEntity>',
            '        </cac:Party>',
            '    </cac:AccountingSupplierParty>',
            '    <cac:AccountingCustomerParty>',
            '        <cac:Party>',
            '            <cac:PartyLegalEntity>',
            '                <cbc:RegistrationName>' . $e($buyer) . '</cbc:RegistrationName>',
            '            </cac:PartyLegalEntity>',
            '        </cac:Party>',
            '    </cac:AccountingCustomerParty>',
            '    <cac:PaymentMeans>',
            "        <cbc:PaymentMeansCode>{$payment}</cbc:PaymentMeansCode>",
            '    </cac:PaymentMeans>',
            '    <cac:TaxTotal>',
            '        <cbc:TaxAmount currencyID="SAR">' . $m($t['vat']) . '</cbc:TaxAmount>',
            '    </cac:TaxTotal>',
            '    <cac:TaxTotal>',
            '        <cbc:TaxAmount currencyID="SAR">' . $m($t['vat']) . '</cbc:TaxAmount>',
            '        <cac:TaxSubtotal>',
            '            <cbc:TaxableAmount currencyID="SAR">' . $m($t['net']) . '</cbc:TaxableAmount>',
            '            <cbc:TaxAmount currencyID="SAR">' . $m($t['vat']) . '</cbc:TaxAmount>',
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
            '        <cbc:LineExtensionAmount currencyID="SAR">' . $m($t['net']) . '</cbc:LineExtensionAmount>',
            '        <cbc:TaxExclusiveAmount currencyID="SAR">' . $m($t['net']) . '</cbc:TaxExclusiveAmount>',
            '        <cbc:TaxInclusiveAmount currencyID="SAR">' . $m($t['gross']) . '</cbc:TaxInclusiveAmount>',
            '        <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>',
            '        <cbc:PrepaidAmount currencyID="SAR">0.00</cbc:PrepaidAmount>',
            '        <cbc:PayableAmount currencyID="SAR">' . $m($t['gross']) . '</cbc:PayableAmount>',
            '    </cac:LegalMonetaryTotal>',
        );
        foreach ($t['rows'] as $r) {
            $L[] = self::lineXml($r);
        }
        $L[] = '</Invoice>';
        return implode("\n", $L);
    }

    /** @param list<string> $values */
    private static function tlv(array $values): string
    {
        $out = '';
        foreach ($values as $i => $v) {
            if (strlen($v) > 255) {
                throw new \LengthException('QR tag ' . ($i + 1) . ' too long');
            }
            $out .= chr($i + 1) . chr(strlen($v)) . $v;
        }
        return $out;
    }

    /**
     * Decode a base64 TLV QR payload.
     *
     * @return list<array{tag:int,value:string}>
     */
    public static function readQr(string $qrB64): array
    {
        $b = (string) base64_decode($qrB64, true);
        $out = [];
        for ($i = 0, $n = strlen($b); $i + 1 < $n;) {
            $len = ord($b[$i + 1]);
            $out[] = ['tag' => ord($b[$i]), 'value' => substr($b, $i + 2, $len)];
            $i += 2 + $len;
        }
        return $out;
    }

    /** XAdES SignedProperties: the hashed form or the form embedded in the XML. */
    public static function signedProps(string $time, Certificate $cert, bool $forSigning): string
    {
        $p = str_repeat(' ', 32);
        $issuer = self::esc($cert->issuer);
        if ($forSigning) {
            $ds = ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"';
            $body = [
                '    <xades:SignedSignatureProperties>',
                "        <xades:SigningTime>{$time}</xades:SigningTime>",
                '        <xades:SigningCertificate>',
                '            <xades:Cert>',
                '                <xades:CertDigest>',
                "                    <ds:DigestMethod{$ds} Algorithm=\"http://www.w3.org/2001/04/xmlenc#sha256\"/>",
                "                    <ds:DigestValue{$ds}>{$cert->hash}</ds:DigestValue>",
                '                </xades:CertDigest>',
                '                <xades:IssuerSerial>',
                "                    <ds:X509IssuerName{$ds}>{$issuer}</ds:X509IssuerName>",
                "                    <ds:X509SerialNumber{$ds}>{$cert->serial}</ds:X509SerialNumber>",
                '                </xades:IssuerSerial>',
                '            </xades:Cert>',
                '        </xades:SigningCertificate>',
                '    </xades:SignedSignatureProperties>',
                '</xades:SignedProperties>',
            ];
            return "<xades:SignedProperties xmlns:xades=\"http://uri.etsi.org/01903/v1.3.2#\" Id=\"xadesSignedProperties\">\n"
                . implode("\n", array_map(static fn (string $l): string => $p . $l, $body));
        }
        $body = [
            '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">',
            '    <xades:SignedSignatureProperties>',
            "        <xades:SigningTime>{$time}</xades:SigningTime>",
            '        <xades:SigningCertificate>',
            '            <xades:Cert>',
            '                <xades:CertDigest>',
            '                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>',
            "                    <ds:DigestValue>{$cert->hash}</ds:DigestValue>",
            '                </xades:CertDigest>',
            '                <xades:IssuerSerial>',
            "                    <ds:X509IssuerName>{$issuer}</ds:X509IssuerName>",
            "                    <ds:X509SerialNumber>{$cert->serial}</ds:X509SerialNumber>",
            '                </xades:IssuerSerial>',
            '            </xades:Cert>',
            '        </xades:SigningCertificate>',
            '    </xades:SignedSignatureProperties>',
            '</xades:SignedProperties>',
        ];
        return implode("\n", array_map(static fn (string $l): string => $p . $l, $body));
    }

    private static function extXml(string $invoiceHash, string $propsHash, string $signature, Certificate $cert, string $props): string
    {
        $x = 'http://www.w3.org/TR/1999/REC-xpath-19991116';
        return "\n" . implode("\n", [
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
            "                                        <ds:Transform Algorithm=\"{$x}\">",
            '                                            <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>',
            '                                        </ds:Transform>',
            "                                        <ds:Transform Algorithm=\"{$x}\">",
            '                                            <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>',
            '                                        </ds:Transform>',
            "                                        <ds:Transform Algorithm=\"{$x}\">",
            "                                            <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>",
            '                                        </ds:Transform>',
            '                                        <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform>',
            '                                    </ds:Transforms>',
            '                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>',
            "                                    <ds:DigestValue>{$invoiceHash}</ds:DigestValue>",
            '                                </ds:Reference>',
            '                                <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">',
            '                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>',
            "                                    <ds:DigestValue>{$propsHash}</ds:DigestValue>",
            '                                </ds:Reference>',
            '                            </ds:SignedInfo>',
            "                            <ds:SignatureValue>{$signature}</ds:SignatureValue>",
            '                            <ds:KeyInfo>',
            '                                <ds:X509Data>',
            "                                    <ds:X509Certificate>{$cert->b64}</ds:X509Certificate>",
            '                                </ds:X509Data>',
            '                            </ds:KeyInfo>',
            '                            <ds:Object>',
            '                            <xades:QualifyingProperties Target="signature" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">',
            $props,
            '                            </xades:QualifyingProperties>',
            '                            </ds:Object>',
            '                        </ds:Signature>',
            '                    </sac:SignatureInformation>',
            '                </sig:UBLDocumentSignatures>',
            '            </ext:ExtensionContent>',
            '        </ext:UBLExtension>',
        ]) . "\n    ";
    }

    /** Load a secp256k1 EC private key from PEM. */
    public static function loadPrivateKey(string $pem): \OpenSSLAsymmetricKey
    {
        $key = openssl_pkey_get_private($pem);
        if ($key === false) {
            throw new \InvalidArgumentException('Invalid private key PEM');
        }
        $d = openssl_pkey_get_details($key);
        if (($d['type'] ?? null) !== OPENSSL_KEYTYPE_EC || ($d['ec']['curve_name'] ?? '') !== 'secp256k1') {
            throw new \InvalidArgumentException('ZATCA requires a secp256k1 EC private key');
        }
        return $key;
    }

    /**
     * Sign a simplified invoice.
     *
     * @param array<string,mixed> $inv
     */
    public static function sign(array $inv, \OpenSSLAsymmetricKey $key, Certificate $cert, ?\DateTimeInterface $now = null): Signed
    {
        $t = self::totals($inv['lines']);
        $pure = self::xml($inv, $t, pure: true);
        $hashBytes = hash('sha256', $pure, true);
        $invoiceHash = base64_encode($hashBytes);
        if (!openssl_sign($hashBytes, $sig, $key, OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('Signing failed: ' . (string) openssl_error_string());
        }
        $signature = base64_encode($sig);
        $time = \DateTimeImmutable::createFromInterface($now ?? new \DateTimeImmutable('now'))
            ->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
        $propsHash = base64_encode(hash('sha256', self::signedProps($time, $cert, true)));
        $qr = base64_encode(self::tlv([
            (string) $inv['seller']['name'],
            (string) $inv['seller']['vat'],
            "{$inv['date']}T{$inv['time']}",
            Num::money($t['gross']),
            Num::money($t['vat']),
            $invoiceHash,
            $signature,
            (string) base64_decode($cert->publicKey, true),
            (string) base64_decode($cert->signature, true),
        ]));
        $ext = self::extXml($invoiceHash, $propsHash, $signature, $cert, self::signedProps($time, $cert, false));
        return new Signed(self::xml($inv, $t, $ext, $qr), $invoiceHash, $signature, $propsHash, $qr, $t, $time);
    }
}
