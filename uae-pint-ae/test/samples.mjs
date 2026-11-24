// Writes sample invoices to out/ for the official PINT AE validation (validate/run.sh).
import { mkdirSync, writeFileSync } from 'node:fs';
import { invoiceXml } from '../src/engine.js';

const dir = new URL('../out/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const seller = { name: 'iFynx Demo Trading LLC', trn: '135790246801003', license: '112345678900003', authority: 'Dubai Department of Economy and Tourism', street: 'Sheikh Zayed Road', city: 'Dubai', emirate: 'DXB', iban: 'AE070331234567890123456' };
const buyer = { name: 'Sample Customer LLC', trn: '134567890123003', license: '112345679000001', authority: 'Abu Dhabi Department of Economic Development', street: 'Corniche Road', city: 'Abu Dhabi', emirate: 'AUH' };
const base = { uuid: '4b6000ca-0128-4bdc-99a6-406f2909247f', issueDate: '2026-11-21', dueDate: '2026-12-21', flags: '00000000', seller, buyer };
const samples = {
  'widget-default': [{ name: 'Laptop computer', hs: '847130', qty: 2, price: 3200 }, { name: 'Laser printer', hs: '844332', qty: 1, price: 850 }],
  'rounding': [{ name: 'Cable', hs: '854442', qty: 3, price: 12.35 }, { name: 'Adapter', hs: '850440', qty: 7, price: 9.99 }, { name: 'Mouse', hs: '847160', qty: 1, price: 0.07 }],
  'arabic-names': [{ name: 'حاسوب محمول', hs: '847130', qty: 1, price: 2999.95 }],
};
let i = 1;
for (const [name, lines] of Object.entries(samples)) {
  const inv = { ...base, number: 'AE-TEST-' + i++, lines };
  if (name === 'arabic-names') inv.seller = { ...seller, name: 'آيفينيكس للتجارة ذ.م.م', city: 'دبي' };
  writeFileSync(dir + name + '.xml', invoiceXml(inv));
}
// Negative control: the validator must reject a Saudi VAT number (IBR-132-AE).
mkdirSync(dir + 'negative', { recursive: true });
writeFileSync(dir + 'negative/saudi-trn.xml', invoiceXml({ ...base, number: 'AE-NEG-1', seller: { ...seller, trn: '399999999900003' }, lines: samples['widget-default'] }));
console.log('wrote', Object.keys(samples).length, 'samples to', dir);
