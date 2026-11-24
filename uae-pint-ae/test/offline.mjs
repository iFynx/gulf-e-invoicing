// Fast checks with no network: totals, the browser rules and well-formed XML.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totals, invoiceXml, check, trnOk } from '../src/engine.js';

const seller = { name: 'A & B <LLC>', trn: '135790246801003', license: '1', authority: 'X', street: 'S', city: 'Dubai', emirate: 'DXB', iban: 'AE070331234567890123456' };
const buyer = { name: 'Buyer', trn: '134567890123003', license: '2', authority: 'Y', street: 'S', city: 'Abu Dhabi', emirate: 'AUH' };
const inv = { number: 'T-1', uuid: '4b6000ca-0128-4bdc-99a6-406f2909247f', issueDate: '2026-11-21', dueDate: '2026-12-21', seller, buyer,
  lines: [{ name: 'Laptop', hs: '847130', qty: 2, price: 3200 }, { name: 'Printer', hs: '844332', qty: 1, price: 850 }] };

const t = totals(inv.lines);
assert.equal(t.net, 7250); assert.equal(t.vat, 362.5); assert.equal(t.gross, 7612.5);
assert.ok(check(inv, t).every((r) => r.ok), 'default invoice passes');
assert.ok(trnOk('100000000000003') && !trnOk('300000000000003') && !trnOk('10000000000003'));
const bad = check({ ...inv, seller: { ...seller, trn: '399999999900003', emirate: 'XXX' } });
assert.deepEqual(bad.filter((r) => !r.ok).map((r) => r.id), ['IBR-132-AE', 'IBR-128-AE']);
const r = totals([{ qty: 3, price: 12.35 }, { qty: 7, price: 9.99 }]);
assert.equal(r.net, 106.98); assert.equal(r.vat, 5.35);

const xml = invoiceXml(inv, t);
assert.ok(xml.includes('A &amp; B &lt;LLC&gt;'));
assert.ok(xml.includes('<cbc:EndpointID schemeID="0235">1357902468</cbc:EndpointID>'));
const dir = mkdtempSync(tmpdir() + '/ue-');
writeFileSync(dir + '/i.xml', xml);
try { execFileSync('xmllint', ['--noout', dir + '/i.xml']); console.log('xmllint ok'); } catch (e) { if (e.code !== 'ENOENT') throw e; console.log('xmllint not installed, skipped'); }
console.log('offline tests passed');
