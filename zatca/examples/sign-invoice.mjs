// Sign a ZATCA Phase 2 simplified tax invoice and print the XML, hash and QR.
// Run: npm run example   (uses the public sandbox demo key in keys/)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { signInvoice, readQr, FIRST_PIH } from '../src/engine.js';
import { certInfo, rawPrivateKey } from '../src/certinfo.mjs';

const keyPath = new URL('../keys/demo-private-key.pem', import.meta.url).pathname;
const key = rawPrivateKey(readFileSync(keyPath, 'utf8'));

// Use your CSID certificate (base64 body) in production. For a local run we
// self-sign one from the demo key so the example works offline.
const pem = execFileSync('openssl', ['req', '-new', '-x509', '-key', keyPath, '-subj', '/CN=example', '-days', '1'], { input: '' }).toString();
const cert = certInfo(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));

const invoice = {
  number: 'INV-0001',
  uuid: randomUUID(),
  date: '2026-11-24',
  time: '09:30:00',
  counter: 1,          // ICV: increases by one for every invoice of this EGS unit
  pih: FIRST_PIH,      // previous invoice hash; FIRST_PIH for the very first invoice
  buyer: 'Walk-in customer',
  seller: {
    name: 'Example Store | متجر تجريبي',
    vat: '399999999900003', crn: '1010010000',
    street: 'King Fahd Road', building: '1234', district: 'Al Olaya', city: 'Riyadh', postal: '12211',
  },
  lines: [
    { name: 'Arabic coffee', qty: 2, price: 12.5 },
    { name: 'Dates box', qty: 1, price: 37.39 },
  ],
};

const r = await signInvoice(invoice, key, cert);
console.log('Total (incl. 15% VAT):', r.totals.gross.toFixed(2), 'SAR');
console.log('Invoice hash (next PIH):', r.invoiceHash);
console.log('QR (base64 TLV):', r.qr.slice(0, 60) + '...');
console.log('QR tags:', readQr(r.qr).map((t) => t.tag).join(', '));
console.log('\n' + r.xml.split('\n').slice(0, 12).join('\n') + '\n...');
