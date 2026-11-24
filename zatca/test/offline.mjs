// Offline checks: hash input equals the signed XML minus the three excluded
// elements, signature verifies, QR decodes, XML is well formed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, createVerify, createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signInvoice, invoiceXml, totals, readQr, FIRST_PIH } from '../src/engine.js';
import { certInfo, rawPrivateKey } from '../src/certinfo.mjs';

const dir = new URL('..', import.meta.url).pathname;
const key = rawPrivateKey(readFileSync(dir + 'keys/demo-private-key.pem', 'utf8'));
const certPem = process.env.CERT || execFileSync('openssl', ['req', '-new', '-x509', '-key', dir + 'keys/demo-private-key.pem', '-subj', '/CN=test', '-days', '1'], { input: '' }).toString();
const cert = certInfo(certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));

export const sample = {
  number: 'INV-1001', uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be', date: '2026-11-21', time: '10:15:00',
  counter: 1, pih: FIRST_PIH, buyer: 'عميل نقدي',
  seller: { name: 'متجر آيفينيكس التجريبي | iFynx Demo Store', vat: '399999999900003', crn: '1010010000', street: 'King Fahd Road', building: '1234', district: 'Al Olaya', city: 'Riyadh', postal: '12211' },
  lines: [{ name: 'قهوة عربية Arabic coffee', qty: 2, price: 12.5 }, { name: 'Dates box <500g> & more', qty: 1, price: 37.39 }],
};

const r = await signInvoice(sample, key, cert);
const stripped = r.xml.replace(/^<\?xml[^>]*\?>\n/, '')
  .replace(/<ext:UBLExtensions>[\s\S]*?<\/ext:UBLExtensions>/, '')
  .replace(/<cac:Signature>[\s\S]*?<\/cac:Signature>/, '')
  .replace(/<cac:AdditionalDocumentReference>\s*<cbc:ID>QR<\/cbc:ID>[\s\S]*?<\/cac:AdditionalDocumentReference>/, '');
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
ok(stripped === invoiceXml(sample, totals(sample.lines), { pure: true }), 'hash input = signed XML minus excluded elements');
ok(createHash('sha256').update(stripped).digest('base64') === r.invoiceHash, 'invoice hash');
const v = createVerify('sha256'); v.update(Buffer.from(r.invoiceHash, 'base64'));
ok(v.verify(createPublicKey({ key: Buffer.from(cert.publicKey, 'base64'), format: 'der', type: 'spki' }), Buffer.from(r.signature, 'base64')), 'signature verifies with certificate key');
const q = readQr(r.qr);
ok(q.length === 9 && new TextDecoder().decode(q[0].bytes) === sample.seller.name && new TextDecoder().decode(q[3].bytes) === r.totals.gross.toFixed(2), 'QR has 9 tags, seller and total');
const out = join(tmpdir(), 'zatca-signed.xml');
writeFileSync(out, r.xml);
try { execFileSync('xmllint', ['--noout', out]); ok(true, 'XML well formed (xmllint)'); } catch (e) { if (e.code === 'ENOENT') console.log('skip xmllint not installed'); else ok(false, 'xmllint: ' + e.message); }
console.log('total', r.totals.gross, 'vat', r.totals.vat);
