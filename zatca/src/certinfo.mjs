// Node helper: values the engine needs from an X.509 certificate (base64 body, no PEM header).
import { X509Certificate, createHash } from 'node:crypto';

function derItems(buf, start, end) {
  const out = [];
  let i = start;
  while (i < end) {
    const tag = buf[i];
    let len = buf[i + 1], hdr = 2;
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = (len << 8) | buf[i + 2 + k]; hdr = 2 + n; }
    out.push({ tag, start: i + hdr, end: i + hdr + len });
    i += hdr + len;
  }
  return out;
}

export function certInfo(b64) {
  const der = Buffer.from(b64, 'base64');
  const x = new X509Certificate(der);
  const [top] = derItems(der, 0, der.length);
  const [, , sigBits] = derItems(der, top.start, top.end);
  return {
    b64,
    hash: Buffer.from(createHash('sha256').update(b64).digest('hex')).toString('base64'),
    issuer: x.issuer.split('\n').reverse().join(', '),
    serial: BigInt('0x' + x.serialNumber).toString(10),
    publicKey: x.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    signature: der.subarray(sigBits.start + 1, sigBits.end).toString('base64'),
  };
}

export function rawPrivateKey(pem) {
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  const [top] = derItems(der, 0, der.length);
  const [, oct] = derItems(der, top.start, top.end);
  return new Uint8Array(der.subarray(oct.start, oct.end));
}
