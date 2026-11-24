// Writes cross-language test vectors (../test-vectors/zatca.json) that the
// Python and PHP ports must reproduce byte-for-byte.
import { readFileSync, writeFileSync } from 'node:fs';
import { signInvoice, invoiceXml, totals, validate, FIRST_PIH } from '../src/engine.js';
import { certInfo, rawPrivateKey } from '../src/certinfo.mjs';

const dir = new URL('..', import.meta.url).pathname;
const key = rawPrivateKey(readFileSync(dir + 'keys/demo-private-key.pem', 'utf8'));
const cert = certInfo(readFileSync(dir + 'keys/demo-cert.txt', 'utf8').trim());
const seller = { name: 'متجر آيفينيكس التجريبي | iFynx Demo Store', vat: '399999999900003', crn: '1010010000', street: 'King Fahd Road', building: '1234', district: 'Al Olaya', city: 'Riyadh', postal: '12211' };
const cases = [
  { number: 'INV-1001', uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be', date: '2026-11-21', time: '10:15:00', counter: 1, pih: FIRST_PIH, buyer: 'عميل نقدي', seller,
    lines: [{ name: 'قهوة عربية Arabic coffee', qty: 2, price: 12.5 }, { name: 'Dates box <500g> & more', qty: 1, price: 37.39 }] },
  { number: 'INV-1002', uuid: '8d0b2a3e-1f4c-4b7a-9a52-6f1e2d3c4b5a', date: '2026-11-21', time: '10:16:30', counter: 2, pih: null, seller,
    lines: [{ name: 'Water 330ml', qty: 12, price: 1.1 }, { name: 'شاي "Tea"', qty: 3, price: 4.35 }, { name: 'Notebook A5', qty: 2, price: 9.99 }] },
  { number: 'INV-1003', uuid: '0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f', date: '2026-11-22', time: '23:59:59', counter: 3, pih: null, seller, buyer: 'Ahmed Ali', payment: '48',
    lines: [{ name: 'Rounding test', qty: 3, price: 0.335 }, { name: 'Zero price gift', qty: 1, price: 0 }] },
];
const now = new Date('2026-11-24T09:30:00Z');
const out = { key_pem_file: 'zatca/keys/demo-private-key.pem', cert_file: 'zatca/keys/demo-cert.txt', now: now.toISOString(), cert, cases: [] };
let pih = FIRST_PIH;
for (const c of cases) {
  const inv = { ...c, pih: c.pih || pih };
  const t = totals(inv.lines);
  const r = await signInvoice(inv, key, cert, now);
  out.cases.push({ invoice: inv, totals: t, validate: validate(inv), pure: invoiceXml(inv, t, { pure: true }), invoiceHash: r.invoiceHash,
    signature: r.signature, propsHash: r.propsHash, qr: r.qr, signingTime: r.signingTime, xml: r.xml });
  pih = r.invoiceHash;
}
out.invalid = [
  { seller: { ...seller, vat: '312345678900003x' }, lines: [], expect: validate({ seller: { ...seller, vat: '312345678900003x' }, lines: [] }) },
  { seller: { ...seller, building: '12', postal: '1221', name: ' ' }, lines: [{ name: 'x', qty: 0, price: 1 }], expect: validate({ seller: { ...seller, building: '12', postal: '1221', name: ' ' }, lines: [{ name: 'x', qty: 0, price: 1 }] }) },
];
writeFileSync(dir + '../test-vectors/zatca.json', JSON.stringify(out, null, 1) + '\n');
console.log('wrote', out.cases.length, 'zatca vectors');
