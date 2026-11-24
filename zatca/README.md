# `zatca/`: ZATCA Phase 2 simplified tax invoice engine

Saudi Arabia's e-invoicing (Fatoora) Phase 2 in one dependency-light file: [`src/engine.js`](src/engine.js).
Works in modern browsers (Web Crypto) and Node.js 20+. The only runtime dependency is
[`@noble/secp256k1`](https://github.com/paulmillr/noble-secp256k1), an audited, zero-dependency curve library.

## What it produces

1. **UBL 2.1 simplified tax invoice** (`InvoiceTypeCode 388`, name `0200000`, profile `reporting:1.0`), SAR, 15% standard rate.
2. **Invoice hash**: SHA-256 over the canonical invoice without `ext:UBLExtensions`, `cac:Signature` and the QR reference. The XML is written already in canonical form, so the hashed bytes are exact and testable.
3. **Signature**: ECDSA secp256k1 over the hash, DER-encoded, base64.
4. **XAdES** signed properties and the full `ds:Signature` block, byte-for-byte in the layout ZATCA's SDK digests.
5. **QR code**: TLV tags 1 to 9 (seller, VAT number, timestamp, total, VAT, hash, signature, public key, certificate signature).
6. **Chaining**: invoice counter (ICV) and previous invoice hash (PIH). Use `FIRST_PIH` for the first invoice of an EGS unit.

## API

| Function | Returns |
|---|---|
| `signInvoice(invoice, privateKey, certificate, now?)` | `{ xml, invoiceHash, signature, propsHash, qr, totals, signingTime }` |
| `totals(lines)` | Line and document totals, rounded per line then per document |
| `validate(invoice)` | Field codes that break ZATCA rules: `vat`, `building`, `postal`, `name`, `lines` |
| `invoiceXml(invoice, totals, parts?)` | Raw XML; `{ pure: true }` gives the exact bytes that are hashed |
| `readQr(base64)` | Decoded TLV tags, for display or debugging |
| `certInfo(base64Cert)` *(Node, `src/certinfo.mjs`)* | Values the engine needs from your CSID certificate |
| `rawPrivateKey(pem)` *(Node)* | 32-byte private key from an EC PEM |

TypeScript declarations: [`src/engine.d.ts`](src/engine.d.ts).

## Run

```sh
npm ci
npm test          # offline: hash input, hash, signature verification, QR, well-formed XML
npm run example   # sign an invoice and print the result
npm run sandbox   # live: compliance CSID + /compliance/invoices on ZATCA's developer portal
```

The sandbox test issues a compliance CSID for [`keys/demo.csr`](keys) with the portal's public test OTP, signs three chained invoices plus one with the stored demo certificate, and fails unless ZATCA answers `PASS` (or `WARNING`).

## Going to production

1. Generate your own secp256k1 key and CSR with your real VAT number and EGS details.
2. Onboard on Fatoora (OTP → compliance CSID → compliance checks → production CSID).
3. Pass your production certificate to `certInfo()` and keep your key in a secure store, never in the browser.
4. Persist `counter` and `invoiceHash` per EGS unit: every invoice must chain to the one before it.
5. Report simplified invoices within 24 hours of issue.

Not covered yet: standard (B2B) clearance invoices, credit/debit notes, zero-rated or exempt lines, allowances. Contributions welcome.
