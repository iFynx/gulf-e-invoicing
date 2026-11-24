# ifynx/gulf-e-invoicing (PHP)

[![Packagist](https://img.shields.io/packagist/v/ifynx/gulf-e-invoicing.svg)](https://packagist.org/packages/ifynx/gulf-e-invoicing)
[![CI](https://github.com/iFynx/gulf-e-invoicing/actions/workflows/ci.yml/badge.svg)](https://github.com/iFynx/gulf-e-invoicing/actions/workflows/ci.yml)

Saudi **ZATCA Phase 2** (Fatoora) simplified tax invoices and **UAE Peppol PINT AE** tax
invoices for PHP 8.1+, with no dependencies beyond `ext-openssl`. Drop it into Laravel,
Symfony, WooCommerce or any POS backend.

Part of the [Gulf e-Invoicing Toolkit](https://github.com/iFynx/gulf-e-invoicing) by [iFynx](https://ifynx.com).
The XML, invoice hash, XAdES properties and QR are tested to match the JavaScript and Python
engines byte-for-byte using shared [test vectors](https://github.com/iFynx/gulf-e-invoicing/tree/main/test-vectors).

```sh
composer require ifynx/gulf-e-invoicing
```

## ZATCA Phase 2

```php
use IFynx\GulfEInvoicing\Zatca\Certificate;
use IFynx\GulfEInvoicing\Zatca\Invoice;

$key  = Invoice::loadPrivateKey(file_get_contents('private-key.pem'));   // secp256k1
$cert = Certificate::fromBase64(file_get_contents('csid-cert.txt'));      // your CSID

$signed = Invoice::sign([
    'number'  => 'INV-0001',
    'uuid'    => '3cf5ee18-ee25-44ea-a444-2c37ba7f28be',
    'date'    => '2026-11-24',
    'time'    => '09:30:00',
    'counter' => 1,                      // ICV
    'pih'     => Invoice::FIRST_PIH,     // previous invoice hash
    'seller'  => [
        'name' => 'My Store', 'vat' => '399999999900003', 'crn' => '1010010000',
        'street' => 'King Fahd Road', 'building' => '1234', 'district' => 'Al Olaya',
        'city' => 'Riyadh', 'postal' => '12211',
    ],
    'lines'   => [['name' => 'Arabic coffee', 'qty' => 2, 'price' => 12.5]],
], $key, $cert);

$signed->xml;          // signed UBL 2.1 invoice
$signed->qr;           // base64 TLV for the QR code
$signed->invoiceHash;  // store it: the PIH of your next invoice
```

`Invoice::validate($invoice)` returns the fields that break basic ZATCA rules
(`vat`, `building`, `postal`, `name`, `lines`).

## UAE PINT AE

```php
use IFynx\GulfEInvoicing\UaePintAe\Invoice;

$results = Invoice::check($invoice);   // [['id' => 'IBR-132-AE', 'key' => 'trn', 'ok' => true], ...]
$xml = Invoice::xml($invoice);         // send through your Accredited Service Provider
```

## Scope

ZATCA: simplified (B2C) invoices at 15%. UAE: standard tax invoice at 5%, AED. See the
[main README](https://github.com/iFynx/gulf-e-invoicing#scope-and-honest-limits) for limits.
This is engineering code, not tax advice.

MIT © iFynx Integrated Solutions P.S.C.
