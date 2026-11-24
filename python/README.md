# gulf-einvoicing (Python)

[![PyPI](https://img.shields.io/pypi/v/gulf-einvoicing.svg)](https://pypi.org/project/gulf-einvoicing/)
[![CI](https://github.com/iFynx/gulf-e-invoicing/actions/workflows/ci.yml/badge.svg)](https://github.com/iFynx/gulf-e-invoicing/actions/workflows/ci.yml)

Saudi **ZATCA Phase 2** (Fatoora) simplified tax invoices and **UAE Peppol PINT AE** tax
invoices in pure Python. Part of the [Gulf e-Invoicing Toolkit](https://github.com/iFynx/gulf-e-invoicing)
by [iFynx](https://ifynx.com).

Every output (XML, invoice hash, XAdES properties, **signature** and QR) is tested to be
**byte-for-byte identical** to the JavaScript engines, using shared
[test vectors](https://github.com/iFynx/gulf-e-invoicing/tree/main/test-vectors). Signatures use
RFC 6979 deterministic nonces with low-S, so the same invoice always signs the same way.

```sh
pip install gulf-einvoicing
```

## ZATCA Phase 2

```python
from gulf_einvoicing import zatca

key = zatca.load_private_key(open("private-key.pem").read())   # secp256k1
cert = zatca.cert_info(open("csid-cert.txt").read())            # base64 CSID certificate

signed = zatca.sign_invoice({
    "number": "INV-0001", "uuid": "3cf5ee18-ee25-44ea-a444-2c37ba7f28be",
    "date": "2026-11-24", "time": "09:30:00",
    "counter": 1, "pih": zatca.FIRST_PIH,        # ICV + previous invoice hash
    "seller": {"name": "My Store", "vat": "399999999900003", "crn": "1010010000",
               "street": "King Fahd Road", "building": "1234", "district": "Al Olaya",
               "city": "Riyadh", "postal": "12211"},
    "lines": [{"name": "Arabic coffee", "qty": 2, "price": 12.5}],
}, key, cert)

signed.xml            # signed UBL 2.1 invoice
signed.qr             # base64 TLV for the QR code
signed.invoice_hash   # store it: the PIH of your next invoice
```

`zatca.validate(invoice)` returns the fields that break basic ZATCA rules
(`vat`, `building`, `postal`, `name`, `lines`).

## UAE PINT AE

```python
from gulf_einvoicing import uae_pint_ae

results = uae_pint_ae.check(invoice)          # [{'id': 'IBR-132-AE', 'key': 'trn', 'ok': True}, ...]
if all(r["ok"] for r in results):
    xml = uae_pint_ae.invoice_xml(invoice)    # send through your Accredited Service Provider
```

## Scope

ZATCA: simplified (B2C) invoices at 15%. UAE: standard tax invoice at 5%, AED. See the
[main README](https://github.com/iFynx/gulf-e-invoicing#scope-and-honest-limits) for limits.
This is engineering code, not tax advice.

## License

MIT © iFynx Integrated Solutions P.S.C.
