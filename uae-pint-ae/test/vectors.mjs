// Writes cross-language test vectors (../test-vectors/uae-pint-ae.json).
import { writeFileSync } from 'node:fs';
import { invoiceXml, totals, check, trnOk, tin } from '../src/engine.js';

const dir = new URL('..', import.meta.url).pathname;
const seller = { name: 'iFynx Demo Trading LLC', trn: '135790246801003', license: '112345678900003', authority: 'Dubai Department of Economy and Tourism', street: 'Sheikh Zayed Road', city: 'Dubai', emirate: 'DXB', iban: 'AE070331234567890123456' };
const buyer = { name: 'Sample Customer LLC', trn: '134567890123003', license: '112345679000001', authority: 'Abu Dhabi Department of Economic Development', street: 'Corniche Road', city: 'Abu Dhabi', emirate: 'AUH' };
const base = { uuid: '4b6000ca-0128-4bdc-99a6-406f2909247f', issueDate: '2026-11-21', dueDate: '2026-12-21', seller, buyer };
const invoices = [
  { ...base, number: 'AE-1', flags: '00000000', lines: [{ name: 'Laptop computer', hs: '847130', qty: 2, price: 3200 }, { name: 'Laser printer', hs: '844332', qty: 1, price: 850 }] },
  { ...base, number: 'AE-2', lines: [{ name: 'Cable', hs: '854442', qty: 3, price: 12.35 }, { name: 'Adapter', hs: '850440', qty: 7, price: 9.99 }, { name: 'Mouse', hs: '847160', qty: 1, price: 0.07, desc: 'Wireless "mouse" <USB>' }] },
  { ...base, number: 'AE-3', seller: { ...seller, name: 'آيفينيكس للتجارة ذ.م.م', city: 'دبي' }, lines: [{ name: 'حاسوب محمول', hs: '847130', qty: 1, price: 2999.95 }] },
  { ...base, number: 'AE-BAD', flags: '0101x', dueDate: '2026-11-01', seller: { ...seller, trn: '399999999900003', emirate: 'XXX', iban: 'SA00' }, lines: [{ name: 'Thing', hs: '12', qty: 1, price: 5 }] },
];
const out = { cases: invoices.map((inv) => { const t = totals(inv.lines); return { invoice: inv, totals: t, xml: invoiceXml(inv, t), check: check(inv, t) }; }),
  trn: ['100000000000003', '300000000000003', '10000000000003', '135790246801003'].map((v) => ({ v, ok: trnOk(v), tin: tin(v) })) };
writeFileSync(dir + '../test-vectors/uae-pint-ae.json', JSON.stringify(out, null, 1) + '\n');
console.log('wrote', out.cases.length, 'uae vectors');
