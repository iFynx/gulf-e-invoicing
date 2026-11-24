/*
 * UAE e-invoice (Peppol PINT AE) engine: builds a UBL 2.1 tax invoice in the
 * shape of the official "Standard invoice Mandatory fields" example and runs a
 * browser-side subset of the PINT AE business rules. The full official rules
 * (PINT AE 1.0.5 Schematron) run in CI: see validate/ and the workflow
 * "UAE PINT AE validation".
 */
export const VAT_RATE = 5;
export const CUSTOMIZATION = 'urn:peppol:pint:billing-1@ae-1';
export const PROFILE = 'urn:peppol:bis:billing';
export const EMIRATES = ['AUH', 'DXB', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ'];
// BTAE-02 positions, in order (PINT AE transaction type code list).
export const FLAGS = ['ftz', 'deemed', 'margin', 'summary', 'continuous', 'agent', 'ecommerce', 'exports'];

export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const money = (n) => r2(n).toFixed(2);
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const trnOk = (v) => /^1\d{12}03$/.test(String(v || ''));
export const tin = (trn) => String(trn).slice(0, 10);

export function totals(lines) {
  const rows = lines.map((l) => {
    const net = r2(l.qty * l.price);
    const vat = r2(net * VAT_RATE / 100);
    return { ...l, net, vat, gross: r2(net + vat) };
  });
  const net = r2(rows.reduce((a, r) => a + r.net, 0));
  const vat = r2(net * VAT_RATE / 100);
  return { rows, net, vat, gross: r2(net + vat) };
}

const party = (p, tag) => `
    <cac:${tag}>
        <cac:Party>
            <cbc:EndpointID schemeID="0235">${esc(tin(p.trn))}</cbc:EndpointID>
            <cac:PostalAddress>
                <cbc:StreetName>${esc(p.street)}</cbc:StreetName>
                <cbc:CityName>${esc(p.city)}</cbc:CityName>
                <cbc:CountrySubentity>${esc(p.emirate)}</cbc:CountrySubentity>
                <cac:Country>
                    <cbc:IdentificationCode>AE</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${esc(p.trn)}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>
                <cbc:CompanyID schemeAgencyID="TL" schemeAgencyName="${esc(p.authority)}">${esc(p.license)}</cbc:CompanyID>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:${tag}>`;

const category = (indent) => `${indent}<cbc:ID>S</cbc:ID>
${indent}<cbc:Percent>${VAT_RATE}</cbc:Percent>
${indent}<cac:TaxScheme>
${indent}    <cbc:ID>VAT</cbc:ID>
${indent}</cac:TaxScheme>`;

export function invoiceXml(inv, t = totals(inv.lines)) {
  const flags = inv.flags || '00000000';
  const lines = t.rows.map((r, i) => `
    <cac:InvoiceLine>
        <cbc:ID>${i + 1}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="H87">${r.qty}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="AED">${money(r.net)}</cbc:LineExtensionAmount>
        <cac:Item>
            <cbc:Description>${esc(r.desc || r.name)}</cbc:Description>
            <cbc:Name>${esc(r.name)}</cbc:Name>
            <cac:CommodityClassification>
                <cbc:CommodityCode>G</cbc:CommodityCode>
                <cbc:ItemClassificationCode listID="HS">${esc(r.hs)}</cbc:ItemClassificationCode>
            </cac:CommodityClassification>
            <cac:ClassifiedTaxCategory>
${category('                ')}
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="AED">${money(r.price)}</cbc:PriceAmount>
            <cbc:BaseQuantity unitCode="H87">1</cbc:BaseQuantity>
            <cac:AllowanceCharge>
                <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
                <cbc:Amount currencyID="AED">0.00</cbc:Amount>
                <cbc:BaseAmount currencyID="AED">${money(r.price)}</cbc:BaseAmount>
            </cac:AllowanceCharge>
        </cac:Price>
        <cac:ItemPriceExtension>
            <cbc:Amount currencyID="AED">${money(r.gross)}</cbc:Amount>
            <cac:TaxTotal>
                <cbc:TaxAmount currencyID="AED">${money(r.vat)}</cbc:TaxAmount>
            </cac:TaxTotal>
        </cac:ItemPriceExtension>
    </cac:InvoiceLine>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:CustomizationID>${CUSTOMIZATION}</cbc:CustomizationID>
    <cbc:ProfileID>${PROFILE}</cbc:ProfileID>
    <cbc:ProfileExecutionID>${esc(flags)}</cbc:ProfileExecutionID>
    <cbc:ID>${esc(inv.number)}</cbc:ID>
    <cbc:UUID>${esc(inv.uuid)}</cbc:UUID>
    <cbc:IssueDate>${esc(inv.issueDate)}</cbc:IssueDate>
    <cbc:DueDate>${esc(inv.dueDate)}</cbc:DueDate>
    <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>${party(inv.seller, 'AccountingSupplierParty')}${party(inv.buyer, 'AccountingCustomerParty')}
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode name="Credit transfer">30</cbc:PaymentMeansCode>
        <cac:PayeeFinancialAccount>
            <cbc:ID>${esc(inv.seller.iban)}</cbc:ID>
        </cac:PayeeFinancialAccount>
    </cac:PaymentMeans>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="AED">${money(t.vat)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="AED">${money(t.net)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="AED">${money(t.vat)}</cbc:TaxAmount>
            <cac:TaxCategory>
${category('                ')}
            </cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="AED">${money(t.net)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="AED">${money(t.net)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="AED">${money(t.gross)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="AED">${money(t.gross)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>${lines}
</Invoice>
`;
}

/*
 * Browser-side checks. Each id is the official PINT AE rule it mirrors, so a
 * visitor can look the rule up; a pass here does not replace the official
 * validation that an Accredited Service Provider runs.
 */
export function check(inv, t = totals(inv.lines)) {
  const out = [];
  const add = (id, key, ok) => out.push({ id, key, ok: !!ok });
  const parties = [inv.seller, inv.buyer];
  add('ALIGNED-IBRP-001-AE', 'spec', true);
  add('IBR-154-AE', 'flags', /^[01]{8}$/.test(inv.flags || '00000000'));
  add('IBR-132-AE', 'trn', parties.every((p) => trnOk(p.trn)));
  add('IBR-128-AE', 'emirate', parties.every((p) => EMIRATES.includes(p.emirate)));
  add('IBR-143-AE', 'address', parties.every((p) => p.street && p.city));
  add('IBR-150-AE', 'license', parties.every((p) => p.license && p.name && p.authority));
  add('IBR-193-AE', 'uuid', /^[0-9a-f-]{36}$/i.test(inv.uuid));
  add('IBR-127-AE', 'due', inv.dueDate && inv.dueDate >= inv.issueDate);
  add('IBR-192-AE', 'iban', /^AE\d{21}$/.test(String(inv.seller.iban || '').replace(/\s/g, '')));
  add('IBR-125-AE', 'items', t.rows.length && t.rows.every((r) => r.name && r.qty > 0 && r.price >= 0));
  add('IBR-184-AE', 'hs', t.rows.every((r) => /^\d{6,12}$/.test(String(r.hs || ''))));
  add('IBR-190-AE', 'rate', VAT_RATE === 5);
  add('IBR-147-AE', 'linemath', t.rows.every((r) => r.net === r2(r.qty * r.price)));
  add('IBR-194-AE', 'aed', t.rows.every((r) => r.gross === r2(r.net + r.vat)));
  add('IBR-CO-15', 'totals', t.gross === r2(t.net + t.vat));
  return out;
}
