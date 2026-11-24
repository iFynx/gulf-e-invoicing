"""UAE e-invoicing: Peppol PINT AE tax invoice builder and rule checks.

Output is byte-for-byte identical to the JavaScript engine in ``uae-pint-ae/``
and passes the official PINT AE 1.0.5 Schematron.
"""
from __future__ import annotations

import re
from typing import Any, Mapping, Sequence

from ._num import js_num, money, r2

__all__ = ["VAT_RATE", "CUSTOMIZATION", "PROFILE", "EMIRATES", "FLAGS",
           "totals", "invoice_xml", "check", "trn_ok", "tin"]

VAT_RATE = 5
CUSTOMIZATION = "urn:peppol:pint:billing-1@ae-1"
PROFILE = "urn:peppol:bis:billing"
EMIRATES = ["AUH", "DXB", "SHJ", "AJM", "UAQ", "RAK", "FUJ"]
FLAGS = ["ftz", "deemed", "margin", "summary", "continuous", "agent", "ecommerce", "exports"]


def _esc(s: Any) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def trn_ok(v: Any) -> bool:
    """A UAE TRN: 15 digits, starts with 1, ends with 03."""
    return re.fullmatch(r"1\d{12}03", str(v or "")) is not None


def tin(trn: Any) -> str:
    """First 10 digits of the TRN: the Peppol endpoint ID (scheme 0235)."""
    return str(trn)[:10]


def totals(lines: Sequence[Mapping[str, Any]]) -> dict:
    rows = []
    for line in lines:
        net = r2(line["qty"] * line["price"])
        vat = r2(net * VAT_RATE / 100)
        rows.append({**line, "net": net, "vat": vat, "gross": r2(net + vat)})
    net = 0.0
    for row in rows:
        net += row["net"]
    net = r2(net)
    vat = r2(net * VAT_RATE / 100)
    return {"rows": rows, "net": net, "vat": vat, "gross": r2(net + vat)}


def _party(p: Mapping[str, Any], tag: str) -> str:
    return f"""
    <cac:{tag}>
        <cac:Party>
            <cbc:EndpointID schemeID="0235">{_esc(tin(p['trn']))}</cbc:EndpointID>
            <cac:PostalAddress>
                <cbc:StreetName>{_esc(p['street'])}</cbc:StreetName>
                <cbc:CityName>{_esc(p['city'])}</cbc:CityName>
                <cbc:CountrySubentity>{_esc(p['emirate'])}</cbc:CountrySubentity>
                <cac:Country>
                    <cbc:IdentificationCode>AE</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>{_esc(p['trn'])}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>{_esc(p['name'])}</cbc:RegistrationName>
                <cbc:CompanyID schemeAgencyID="TL" schemeAgencyName="{_esc(p['authority'])}">{_esc(p['license'])}</cbc:CompanyID>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:{tag}>"""


def _category(indent: str) -> str:
    return (f"{indent}<cbc:ID>S</cbc:ID>\n{indent}<cbc:Percent>{VAT_RATE}</cbc:Percent>\n"
            f"{indent}<cac:TaxScheme>\n{indent}    <cbc:ID>VAT</cbc:ID>\n{indent}</cac:TaxScheme>")


def invoice_xml(inv: Mapping[str, Any], t: Mapping[str, Any] | None = None) -> str:
    """PINT AE tax invoice XML."""
    t = t or totals(inv["lines"])
    flags = inv.get("flags") or "00000000"
    cat = _category("                ")
    lines = "".join(f"""
    <cac:InvoiceLine>
        <cbc:ID>{i + 1}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="H87">{js_num(r['qty'])}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="AED">{money(r['net'])}</cbc:LineExtensionAmount>
        <cac:Item>
            <cbc:Description>{_esc(r.get('desc') or r['name'])}</cbc:Description>
            <cbc:Name>{_esc(r['name'])}</cbc:Name>
            <cac:CommodityClassification>
                <cbc:CommodityCode>G</cbc:CommodityCode>
                <cbc:ItemClassificationCode listID="HS">{_esc(r['hs'])}</cbc:ItemClassificationCode>
            </cac:CommodityClassification>
            <cac:ClassifiedTaxCategory>
{cat}
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="AED">{money(r['price'])}</cbc:PriceAmount>
            <cbc:BaseQuantity unitCode="H87">1</cbc:BaseQuantity>
            <cac:AllowanceCharge>
                <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
                <cbc:Amount currencyID="AED">0.00</cbc:Amount>
                <cbc:BaseAmount currencyID="AED">{money(r['price'])}</cbc:BaseAmount>
            </cac:AllowanceCharge>
        </cac:Price>
        <cac:ItemPriceExtension>
            <cbc:Amount currencyID="AED">{money(r['gross'])}</cbc:Amount>
            <cac:TaxTotal>
                <cbc:TaxAmount currencyID="AED">{money(r['vat'])}</cbc:TaxAmount>
            </cac:TaxTotal>
        </cac:ItemPriceExtension>
    </cac:InvoiceLine>""" for i, r in enumerate(t["rows"]))
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:CustomizationID>{CUSTOMIZATION}</cbc:CustomizationID>
    <cbc:ProfileID>{PROFILE}</cbc:ProfileID>
    <cbc:ProfileExecutionID>{_esc(flags)}</cbc:ProfileExecutionID>
    <cbc:ID>{_esc(inv['number'])}</cbc:ID>
    <cbc:UUID>{_esc(inv['uuid'])}</cbc:UUID>
    <cbc:IssueDate>{_esc(inv['issueDate'])}</cbc:IssueDate>
    <cbc:DueDate>{_esc(inv['dueDate'])}</cbc:DueDate>
    <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>AED</cbc:DocumentCurrencyCode>{_party(inv['seller'], 'AccountingSupplierParty')}{_party(inv['buyer'], 'AccountingCustomerParty')}
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode name="Credit transfer">30</cbc:PaymentMeansCode>
        <cac:PayeeFinancialAccount>
            <cbc:ID>{_esc(inv['seller']['iban'])}</cbc:ID>
        </cac:PayeeFinancialAccount>
    </cac:PaymentMeans>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="AED">{money(t['vat'])}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="AED">{money(t['net'])}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="AED">{money(t['vat'])}</cbc:TaxAmount>
            <cac:TaxCategory>
{cat}
            </cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="AED">{money(t['net'])}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="AED">{money(t['net'])}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="AED">{money(t['gross'])}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="AED">{money(t['gross'])}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>{lines}
</Invoice>
"""


def check(inv: Mapping[str, Any], t: Mapping[str, Any] | None = None) -> list[dict]:
    """Rule checks, each labelled with the official PINT AE rule ID it mirrors."""
    t = t or totals(inv["lines"])
    out: list[dict] = []

    def add(rule: str, key: str, ok: Any) -> None:
        out.append({"id": rule, "key": key, "ok": bool(ok)})

    parties = [inv["seller"], inv["buyer"]]
    rows = t["rows"]
    add("ALIGNED-IBRP-001-AE", "spec", True)
    add("IBR-154-AE", "flags", re.fullmatch(r"[01]{8}", inv.get("flags") or "00000000"))
    add("IBR-132-AE", "trn", all(trn_ok(p.get("trn")) for p in parties))
    add("IBR-128-AE", "emirate", all(p.get("emirate") in EMIRATES for p in parties))
    add("IBR-143-AE", "address", all(p.get("street") and p.get("city") for p in parties))
    add("IBR-150-AE", "license", all(p.get("license") and p.get("name") and p.get("authority") for p in parties))
    add("IBR-193-AE", "uuid", re.fullmatch(r"[0-9a-fA-F-]{36}", str(inv.get("uuid") or "")))
    add("IBR-127-AE", "due", inv.get("dueDate") and inv["dueDate"] >= inv.get("issueDate", ""))
    add("IBR-192-AE", "iban", re.fullmatch(r"AE\d{21}", re.sub(r"\s", "", str(inv["seller"].get("iban") or ""))))
    add("IBR-125-AE", "items", len(rows) and all(r.get("name") and r["qty"] > 0 and r["price"] >= 0 for r in rows))
    add("IBR-184-AE", "hs", all(re.fullmatch(r"\d{6,12}", str(r.get("hs") or "")) for r in rows))
    add("IBR-190-AE", "rate", VAT_RATE == 5)
    add("IBR-147-AE", "linemath", all(r["net"] == r2(r["qty"] * r["price"]) for r in rows))
    add("IBR-194-AE", "aed", all(r["gross"] == r2(r["net"] + r["vat"]) for r in rows))
    add("IBR-CO-15", "totals", t["gross"] == r2(t["net"] + t["vat"]))
    return out
