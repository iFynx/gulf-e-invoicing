export const FIRST_PIH: string;
export const VAT_RATE: number;

export interface Seller {
  name: string; vat: string; crn: string;
  street: string; building: string; district: string; city: string; postal: string;
}
export interface Line { name: string; qty: number; price: number }
export interface Invoice {
  number: string; uuid: string; date: string; time: string;
  counter: number; pih: string; buyer?: string; payment?: string;
  seller: Seller; lines: Line[];
}
export interface Totals {
  rows: Array<Line & { id: number; net: number; vat: number; gross: number }>;
  net: number; vat: number; gross: number;
}
export interface Certificate {
  b64: string; hash: string; issuer: string; serial: string; publicKey: string; signature: string;
}
export interface Signed {
  xml: string; invoiceHash: string; signature: string; propsHash: string;
  qr: string; totals: Totals; signingTime: string;
}

export function totals(lines: Line[]): Totals;
export function validate(inv: Invoice): Array<'vat' | 'building' | 'postal' | 'name' | 'lines'>;
export function invoiceXml(inv: Invoice, t: Totals, parts?: { ext?: string; qr?: string; pure?: boolean }): string;
export function signInvoice(inv: Invoice, key: Uint8Array, cert: Certificate, now?: Date): Promise<Signed>;
export function readQr(qrB64: string): Array<{ tag: number; bytes: Uint8Array }>;
export function signedProps(time: string, cert: Certificate, forSigning: boolean): string;
export function sha256(data: string | Uint8Array): Promise<Uint8Array>;
export function esc(s: unknown): string;
export function r2(n: number): number;
export function money(n: number): string;
export function b64(bytes: Uint8Array): string;
export function unb64(str: string): Uint8Array;
