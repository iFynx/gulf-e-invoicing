// Build a UAE PINT AE tax invoice, run the rule checks and print the XML.
// Run: npm run example
import { randomUUID } from 'node:crypto';
import { invoiceXml, check, totals } from '../src/engine.js';

const invoice = {
  number: 'AE-0001',
  uuid: randomUUID(),
  issueDate: '2026-11-24',
  dueDate: '2026-12-24',
  flags: '00000000', // ProfileExecutionID: 8 transaction-type flags (free zone, deemed supply, ...)
  seller: {
    name: 'Example Trading LLC', trn: '135790246801003',
    license: '112345678900003', authority: 'Dubai Department of Economy and Tourism',
    street: 'Sheikh Zayed Road', city: 'Dubai', emirate: 'DXB', iban: 'AE070331234567890123456',
  },
  buyer: {
    name: 'Sample Customer LLC', trn: '134567890123003',
    license: '112345679000001', authority: 'Abu Dhabi Department of Economic Development',
    street: 'Corniche Road', city: 'Abu Dhabi', emirate: 'AUH',
  },
  lines: [
    { name: 'Laptop computer', hs: '847130', qty: 2, price: 3200 },
    { name: 'Laser printer', hs: '844332', qty: 1, price: 850 },
  ],
};

const t = totals(invoice.lines);
for (const r of check(invoice, t)) console.log(r.ok ? 'pass' : 'FAIL', r.id);
console.log(`\nNet ${t.net.toFixed(2)} + VAT ${t.vat.toFixed(2)} = ${t.gross.toFixed(2)} AED\n`);
console.log(invoiceXml(invoice, t));
