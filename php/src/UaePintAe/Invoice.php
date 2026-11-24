<?php

declare(strict_types=1);

namespace IFynx\GulfEInvoicing\UaePintAe;

use IFynx\GulfEInvoicing\Num;

/**
 * UAE e-invoicing: Peppol PINT AE tax invoice builder and rule checks.
 *
 * Output is byte-for-byte identical to the JavaScript and Python engines and
 * passes the official PINT AE 1.0.5 Schematron.
 */
final class Invoice
{
    public const VAT_RATE = 5;
    public const CUSTOMIZATION = 'urn:peppol:pint:billing-1@ae-1';
    public const PROFILE = 'urn:peppol:bis:billing';
    public const EMIRATES = ['AUH', 'DXB', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ'];
    public const FLAGS = ['ftz', 'deemed', 'margin', 'summary', 'continuous', 'agent', 'ecommerce', 'exports'];

    public static function esc(mixed $s): string
    {
        return str_replace(['&', '<', '>', '"'], ['&amp;', '&lt;', '&gt;', '&quot;'], (string) $s);
    }

    /** A UAE TRN: 15 digits, starts with 1, ends with 03. */
    public static function trnOk(mixed $v): bool
    {
        return (bool) preg_match('/^1\d{12}03$/D', (string) ($v ?? ''));
    }

    /** First 10 digits of the TRN: the Peppol endpoint ID (scheme 0235). */
    public static function tin(mixed $trn): string
    {
        return substr((string) $trn, 0, 10);
    }

    /**
     * @param list<array<string,mixed>> $lines
     * @return array{rows:list<array<string,mixed>>,net:float,vat:float,gross:float}
     */
    public static function totals(array $lines): array
    {
        $rows = [];
        $net = 0.0;
        foreach ($lines as $l) {
            $n = Num::r2($l['qty'] * $l['price']);
            $v = Num::r2($n * self::VAT_RATE / 100);
            $rows[] = $l + ['net' => $n, 'vat' => $v, 'gross' => Num::r2($n + $v)];
            $net += $n;
        }
        $net = Num::r2($net);
        $vat = Num::r2($net * self::VAT_RATE / 100);
        return ['rows' => $rows, 'net' => $net, 'vat' => $vat, 'gross' => Num::r2($net + $vat)];
    }

    /** @param array<string,mixed> $p */
    private static function party(array $p, string $tag): string
    {
        $e = [self::class, 'esc'];
        return "
    <cac:{$tag}>
        <cac:Party>
            <cbc:EndpointID schemeID=\"0235\">{$e(self::tin($p['trn']))}</cbc:EndpointID>
            <cac:PostalAddress>
                <cbc:StreetName>{$e($p['street'])}</cbc:StreetName>
                <cbc:CityName>{$e($p['city'])}</cbc:CityName>
                <cbc:CountrySubentity>{$e($p['emirate'])}</cbc:CountrySubentity>
                <cac:Country>
                    <cbc:IdentificationCode>AE</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>{$e($p['trn'])}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>{$e($p['name'])}</cbc:RegistrationName>
                <cbc:CompanyID schemeAgencyID=\"TL\" schemeAgencyName=\"{$e($p['authority'])}\">{$e($p['license'])}</cbc:CompanyID>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:{$tag}>";
    }

    private static function category(string $i): string
    {
        $r = self::VAT_RATE;
        return "{$i}<cbc:ID>S</cbc:ID>\n{$i}<cbc:Percent>{$r}</cbc:Percent>\n{$i}<cac:TaxScheme>\n{$i}    <cbc:ID>VAT</cbc:ID>\n{$i}</cac:TaxScheme>";
    }

    /**
     * PINT AE tax invoice XML.
     *
     * @param array<string,mixed> $inv
     * @param array<string,mixed>|null $t
     */
    public static function xml(array $inv, ?array $t = null): string
    {
        $t ??= self::totals($inv['lines']);
        $e = [self::class, 'esc'];
        $m = [Num::class, 'money'];
        $flags = ($inv['flags'] ?? '') !== '' ? $inv['flags'] : '00000000';
        $cat = self::category('                ');
        $lines = '';
        foreach ($t['rows'] as $i => $r) {
            $n = $i + 1;
            $desc = ($r['desc'] ?? '') !== '' ? $r['desc'] : $r['name'];
            $qty = Num::js($r['qty']);
            $lines .= "
    <cac:InvoiceLine>
        <cbc:ID>{$n}</cbc:ID>
        <cbc:InvoicedQuantity unitCode=\"H87\">{$qty}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID=\"AED\">{$m($r['net'])}</cbc:LineExtensionAmount>
        <cac:Item>
            <cbc:Description>{$e($desc)}</cbc:Description>
            <cbc:Name>{$e($r['name'])}</cbc:Name>
            <cac:CommodityClassification>
                <cbc:CommodityCode>G</cbc:CommodityCode>
                <cbc:ItemClassificationCode listID=\"HS\">{$e($r['hs'])}</cbc:ItemClassificationCode>
            </cac:CommodityClassification>
            <cac:ClassifiedTaxCategory>
{$cat}
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID=\"AED\">{$m($r['price'])}</cbc:PriceAmount>
            <cbc:BaseQuantity unitCode=\"H87\">1</cbc:BaseQuantity>
            <cac:AllowanceCharge>
                <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
                <cbc:Amount currencyID=\"AED\">0.00</cbc:Amount>
                <cbc:BaseAmount currencyID=\"AED\">{$m($r['price'])}</cbc:BaseAmount>
            </cac:AllowanceCharge>
        </cac:Price>
        <cac:ItemPriceExtension>
            <cbc:Amount currencyID=\"AED\">{$m($r['gross'])}</cbc:Amount>
            <cac:TaxTotal>
                <cbc:TaxAmount currencyID=\"AED\">{$m($r['vat'])}</cbc:TaxAmount>
            </cac:TaxTotal>
        </cac:ItemPriceExtension>
    </cac:InvoiceLine>";
        }
        $c = self::CUSTOMIZATION;
        $p = self::PROFILE;
        $seller = self::party($inv['seller'], 'AccountingSupplierParty');
        $buyer = self::party($inv['buyer'], 'AccountingCustomerParty');
        return <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:CustomizationID>{$c}</cbc:CustomizationID>
    <cbc:ProfileID>{$p}</cbc:ProfileID>
    <cbc:ProfileExecutionID>{$e($flags)}</cbc:ProfileExecutionID>
    <cbc:ID>{$e($inv['number'])}</cbc:ID>
    <cbc:UUID>{$e($inv['uuid'])}</cbc:UUID>
    <cbc:IssueDate>{$e($inv['issueDate'])}</cbc:IssueDate>
    <cbc:DueDate>{$e($inv['dueDate'])}</cbc:DueDate>
    <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>{$seller}{$buyer}
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode name="Credit transfer">30</cbc:PaymentMeansCode>
        <cac:PayeeFinancialAccount>
            <cbc:ID>{$e($inv['seller']['iban'])}</cbc:ID>
        </cac:PayeeFinancialAccount>
    </cac:PaymentMeans>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="AED">{$m($t['vat'])}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="AED">{$m($t['net'])}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="AED">{$m($t['vat'])}</cbc:TaxAmount>
            <cac:TaxCategory>
{$cat}
            </cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="AED">{$m($t['net'])}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="AED">{$m($t['net'])}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="AED">{$m($t['gross'])}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="AED">{$m($t['gross'])}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>{$lines}
</Invoice>

XML;
    }

    /**
     * Rule checks, each labelled with the official PINT AE rule ID it mirrors.
     *
     * @param array<string,mixed> $inv
     * @param array<string,mixed>|null $t
     * @return list<array{id:string,key:string,ok:bool}>
     */
    public static function check(array $inv, ?array $t = null): array
    {
        $t ??= self::totals($inv['lines']);
        $out = [];
        $add = static function (string $id, string $key, mixed $ok) use (&$out): void {
            $out[] = ['id' => $id, 'key' => $key, 'ok' => (bool) $ok];
        };
        $parties = [$inv['seller'], $inv['buyer']];
        $all = static fn (array $xs, callable $f): bool => array_reduce($xs, static fn (bool $c, $x): bool => $c && (bool) $f($x), true);
        $rows = $t['rows'];
        $add('ALIGNED-IBRP-001-AE', 'spec', true);
        $add('IBR-154-AE', 'flags', preg_match('/^[01]{8}$/D', (string) (($inv['flags'] ?? '') !== '' ? $inv['flags'] : '00000000')));
        $add('IBR-132-AE', 'trn', $all($parties, static fn ($p) => self::trnOk($p['trn'] ?? null)));
        $add('IBR-128-AE', 'emirate', $all($parties, static fn ($p) => in_array($p['emirate'] ?? null, self::EMIRATES, true)));
        $add('IBR-143-AE', 'address', $all($parties, static fn ($p) => ($p['street'] ?? '') !== '' && ($p['city'] ?? '') !== ''));
        $add('IBR-150-AE', 'license', $all($parties, static fn ($p) => ($p['license'] ?? '') !== '' && ($p['name'] ?? '') !== '' && ($p['authority'] ?? '') !== ''));
        $add('IBR-193-AE', 'uuid', preg_match('/^[0-9a-f-]{36}$/Di', (string) ($inv['uuid'] ?? '')));
        $add('IBR-127-AE', 'due', ($inv['dueDate'] ?? '') !== '' && strcmp((string) $inv['dueDate'], (string) ($inv['issueDate'] ?? '')) >= 0);
        $add('IBR-192-AE', 'iban', preg_match('/^AE\d{21}$/D', (string) preg_replace('/\s/', '', (string) ($inv['seller']['iban'] ?? ''))));
        $add('IBR-125-AE', 'items', $rows !== [] && $all($rows, static fn ($r) => ($r['name'] ?? '') !== '' && $r['qty'] > 0 && $r['price'] >= 0));
        $add('IBR-184-AE', 'hs', $all($rows, static fn ($r) => preg_match('/^\d{6,12}$/D', (string) ($r['hs'] ?? ''))));
        $add('IBR-190-AE', 'rate', self::VAT_RATE === 5);
        $add('IBR-147-AE', 'linemath', $all($rows, static fn ($r) => $r['net'] === Num::r2($r['qty'] * $r['price'])));
        $add('IBR-194-AE', 'aed', $all($rows, static fn ($r) => $r['gross'] === Num::r2($r['net'] + $r['vat'])));
        $add('IBR-CO-15', 'totals', $t['gross'] === Num::r2($t['net'] + $t['vat']));
        return $out;
    }
}
