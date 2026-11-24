# `uae-pint-ae/`: UAE e-invoicing (Peppol PINT AE) invoice builder

Builds a UAE tax invoice in the **PINT AE** format (Peppol BIS Billing 3, UBL 2.1,
`urn:peppol:pint:billing-1@ae-1`) and checks it with 15 rules, each labelled with the
official PINT AE rule ID so you can look it up. No dependencies. Browser and Node.js 20+.

## Validated against the official rules

[`validate/run.sh`](validate/run.sh) downloads the official **PINT AE 1.0.5** Schematron
(the copy published in the [phive-rules](https://github.com/phax/phive-rules) project) and
Saxon HE, validates every sample invoice, and also runs a **negative control** (an invoice with
a Saudi VAT number) that must be rejected with `IBR-132-AE`. If the negative control passes,
the run fails, so the validator can never silently stop checking.

```sh
npm test            # offline: totals, rounding, rules, XML escaping, well-formed XML
npm run example     # build an invoice and print the checks + XML
npm run validate    # official Schematron (needs Java 17+ and internet for the first download)
```

## API

| Function | Returns |
|---|---|
| `invoiceXml(invoice, totals?)` | PINT AE XML string |
| `check(invoice, totals?)` | `[{ id: 'IBR-132-AE', key: 'trn', ok: true }, ...]` |
| `totals(lines)` | Line and document net, VAT (5%) and gross |
| `trnOk(trn)` | `true` for a 15-digit TRN that starts with 1 and ends with 03 |
| `tin(trn)` | First 10 digits of the TRN, used as the Peppol endpoint ID (scheme `0235`) |

TypeScript declarations: [`src/engine.d.ts`](src/engine.d.ts).

## Rules checked in the browser

`ALIGNED-IBRP-001-AE` spec ID · `IBR-154-AE` transaction flags · `IBR-132-AE` TRN format ·
`IBR-128-AE` emirate code · `IBR-143-AE` address · `IBR-150-AE` trade licence ·
`IBR-193-AE` UUID · `IBR-127-AE` due date · `IBR-192-AE` IBAN · `IBR-125-AE` items ·
`IBR-184-AE` HS code · `IBR-190-AE` VAT rate · `IBR-147-AE` line maths ·
`IBR-194-AE` AED amounts · `IBR-CO-15` totals.

A pass here is a fast pre-check. The official Schematron and your Accredited Service
Provider remain the final word. The sample TRNs come from the official specification examples
and are not real taxpayers.
