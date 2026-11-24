export const VAT_RATE: number;
export const CUSTOMIZATION: string;
export const PROFILE: string;
export const EMIRATES: string[];
export const FLAGS: string[];

export interface Party {
  name: string; trn: string; license: string; authority: string;
  street: string; city: string; emirate: string; iban?: string;
}
export interface Line { name: string; hs: string; qty: number; price: number; desc?: string }
export interface Invoice {
  number: string; uuid: string; issueDate: string; dueDate: string; flags?: string;
  seller: Party & { iban: string }; buyer: Party; lines: Line[];
}
export interface Totals {
  rows: Array<Line & { net: number; vat: number; gross: number }>;
  net: number; vat: number; gross: number;
}
export interface RuleResult { id: string; key: string; ok: boolean }

export function totals(lines: Line[]): Totals;
export function invoiceXml(inv: Invoice, t?: Totals): string;
export function check(inv: Invoice, t?: Totals): RuleResult[];
export function trnOk(v: string): boolean;
export function tin(trn: string): string;
export function r2(n: number): number;
export function money(n: number): string;
export function esc(s: unknown): string;
