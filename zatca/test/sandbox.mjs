// Live check against ZATCA's developer-portal sandbox (needs open internet):
// 1) issue a compliance CSID for keys/demo.csr with the portal's public OTP,
// 2) sign three chained demo invoices with the engine, 3) submit each to
// /compliance/invoices and print ZATCA's validation result.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { signInvoice, FIRST_PIH } from '../src/engine.js';
import { certInfo, rawPrivateKey } from '../src/certinfo.mjs';

const BASE = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal';
const dir = new URL('..', import.meta.url).pathname;

async function call(path, body, headers) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Version': 'V2', 'Accept-Language': 'en', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const csr = readFileSync(dir + 'keys/demo.csr', 'utf8');
const c = await call('/compliance', { csr: Buffer.from(csr).toString('base64') }, { OTP: '123345' });
console.log('compliance CSID:', c.status, c.json.requestID, c.json.dispositionMessage, c.json.errors || '');
if (!c.json.binarySecurityToken) { console.log(JSON.stringify(c.json, null, 2)); process.exit(1); }
const certB64 = Buffer.from(c.json.binarySecurityToken, 'base64').toString();
console.log('CERT_B64=' + certB64);
const cert = certInfo(certB64);
console.log('issuer:', cert.issuer, 'serial:', cert.serial);
const auth = 'Basic ' + Buffer.from(c.json.binarySecurityToken + ':' + c.json.secret).toString('base64');
const key = rawPrivateKey(readFileSync(dir + 'keys/demo-private-key.pem', 'utf8'));

const seller = { name: 'متجر آيفينيكس التجريبي | iFynx Demo Store', vat: '399999999900003', crn: '1010010000', street: 'King Fahd Road', building: '1234', district: 'Al Olaya', city: 'Riyadh', postal: '12211' };
const carts = [
  [{ name: 'قهوة عربية', qty: 2, price: 12.5 }, { name: 'تمر سكري 500g', qty: 1, price: 37.39 }],
  [{ name: 'Laptop stand', qty: 1, price: 149 }],
  [{ name: 'شاي', qty: 3, price: 4.35 }, { name: 'Water 330ml', qty: 12, price: 1.1 }, { name: 'Notebook A5', qty: 2, price: 9.99 }],
];
let pih = FIRST_PIH, fails = 0;
const now = new Date();
for (let i = 0; i < carts.length; i++) {
  const inv = {
    number: 'DEMO-' + (1001 + i), uuid: randomUUID(), date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 19),
    counter: i + 1, pih, seller, lines: carts[i], buyer: i === 1 ? 'Ahmed Ali' : '',
  };
  const r = await signInvoice(inv, key, cert, now);
  const v = await call('/compliance/invoices', { invoiceHash: r.invoiceHash, uuid: inv.uuid, invoice: Buffer.from(r.xml).toString('base64') }, { Authorization: auth });
  const vr = v.json.validationResults || {};
  console.log(`\ninvoice ${inv.number}: HTTP ${v.status} status=${vr.status} reporting=${v.json.reportingStatus}`);
  for (const k of ['errorMessages', 'warningMessages']) for (const m of vr[k] || []) console.log(`  ${k === 'errorMessages' ? 'ERROR' : 'WARN '} ${m.code}: ${m.message}`);
  if (vr.status !== 'PASS' && vr.status !== 'WARNING') fails++;
  pih = r.invoiceHash;
}
// The certificate embedded in the public demo (keys/demo-cert.txt) must pass too.
const demoCert = certInfo(readFileSync(dir + 'keys/demo-cert.txt', 'utf8').trim());
const inv = { number: 'DEMO-2001', uuid: randomUUID(), date: now.toISOString().slice(0, 10), time: now.toISOString().slice(11, 19), counter: 1, pih: FIRST_PIH, seller, lines: carts[0] };
const r = await signInvoice(inv, key, demoCert, now);
const v = await call('/compliance/invoices', { invoiceHash: r.invoiceHash, uuid: inv.uuid, invoice: Buffer.from(r.xml).toString('base64') }, { Authorization: auth });
const vr = v.json.validationResults || {};
console.log(`\nembedded demo certificate ${inv.number}: HTTP ${v.status} status=${vr.status} reporting=${v.json.reportingStatus}`);
for (const k of ['errorMessages', 'warningMessages']) for (const m of vr[k] || []) console.log(`  ${k === 'errorMessages' ? 'ERROR' : 'WARN '} ${m.code}: ${m.message}`);
if (vr.status !== 'PASS' && vr.status !== 'WARNING') fails++;
process.exit(fails ? 1 : 0);
