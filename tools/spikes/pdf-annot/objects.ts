// PDF object model, parser and serializer (spike S2). Reads hostile bytes: every loop and depth is bounded.
export class Name { constructor(readonly v: string) {} }
export class Ref { constructor(readonly n: number, readonly g: number) {} }
export class Str { constructor(readonly b: Buffer) {} }
export type Dict = Map<string, Val>;
export type Val = null | boolean | number | Name | Ref | Str | Val[] | Dict;
export interface Indirect { num: number; gen: number; val: Val; dataStart: number }

export type Fail = 'damaged' | 'unsupported';
export class PdfError extends Error {
  constructor(readonly kind: Fail, readonly code: string) { super(code); }
}
export class Eof extends PdfError { constructor() { super('damaged', 'eof'); } }
export const damaged = (code: string): never => { throw new PdfError('damaged', code); };

const MAX_DEPTH = 64;
const MAX_STR = 65536;
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const isReg = (c: number) => !WS.has(c) && !DELIM.has(c);
const isDigit = (c: number) => c >= 48 && c <= 57;

export class Lexer {
  constructor(readonly buf: Buffer, public pos = 0, readonly base = 0) {}
  byte(): number { if (this.pos >= this.buf.length) throw new Eof(); return this.buf[this.pos]!; }
  skipWs(): void {
    for (;;) {
      const c = this.buf[this.pos];
      if (c === undefined) return;
      if (WS.has(c)) this.pos++;
      else if (c === 37) { while (this.pos < this.buf.length && this.buf[this.pos] !== 10 && this.buf[this.pos] !== 13) this.pos++; }
      else return;
    }
  }
  word(): string {
    this.skipWs();
    const s = this.pos;
    while (this.pos < this.buf.length && isReg(this.buf[this.pos]!)) this.pos++;
    if (this.pos >= this.buf.length) throw new Eof(); // a token touching the window end may be cut
    return this.buf.toString('latin1', s, this.pos);
  }
  private num(): number | undefined {
    const s = this.pos;
    let p = s;
    if (this.buf[p] === 43 || this.buf[p] === 45) p++;
    let digits = 0, dot = false;
    for (; p < this.buf.length; p++) {
      const c = this.buf[p]!;
      if (isDigit(c)) digits++;
      else if (c === 46 && !dot) dot = true;
      else break;
    }
    if (digits === 0 || p >= this.buf.length) { if (p >= this.buf.length && digits) throw new Eof(); return undefined; }
    this.pos = p;
    return Number(this.buf.toString('latin1', s, p));
  }
  value(depth = 0): Val {
    if (depth > MAX_DEPTH) return damaged('depth');
    this.skipWs();
    const c = this.byte();
    if (c === 47) return this.name();
    if (c === 40) return this.litString();
    if (c === 60) return this.buf[this.pos + 1] === 60 ? this.dict(depth) : this.hexString();
    if (c === 91) {
      this.pos++;
      const a: Val[] = [];
      for (;;) {
        this.skipWs();
        if (this.byte() === 93) { this.pos++; return a; }
        a.push(this.value(depth + 1));
        if (a.length > 5_000_000) return damaged('array');
      }
    }
    if (isDigit(c) || c === 43 || c === 45 || c === 46) {
      const n = this.num();
      if (n === undefined) return damaged('number');
      if (Number.isInteger(n) && n >= 0 && isDigit(c)) {
        const save = this.pos;
        this.skipWs();
        const g = this.num();
        if (g !== undefined && Number.isInteger(g) && g >= 0) {
          this.skipWs();
          if (this.byte() === 82) {
            const nx = this.buf[this.pos + 1];
            if (nx === undefined) throw new Eof();
            if (!isReg(nx)) { this.pos++; return new Ref(n, g); }
          }
        }
        this.pos = save;
      }
      return n;
    }
    const w = this.word();
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return damaged('token');
  }
  name(): Name {
    this.pos++;
    const s = this.pos;
    while (this.pos < this.buf.length && isReg(this.buf[this.pos]!)) this.pos++;
    if (this.pos >= this.buf.length) throw new Eof();
    if (this.pos - s > MAX_STR) return damaged('name');
    return new Name(this.buf.toString('latin1', s, this.pos).replace(/#([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))));
  }
  litString(): Str {
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (depth > 0) {
      let c = this.byte();
      this.pos++;
      if (out.length > MAX_STR) return damaged('string');
      if (c === 92) {
        c = this.byte();
        this.pos++;
        if (c === 110) out.push(10); else if (c === 114) out.push(13); else if (c === 116) out.push(9);
        else if (c === 98) out.push(8); else if (c === 102) out.push(12);
        else if (c === 13) { if (this.buf[this.pos] === 10) this.pos++; }
        else if (c === 10) { /* line continuation */ }
        else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let i = 0; i < 2 && (this.buf[this.pos] ?? 0) >= 48 && (this.buf[this.pos] ?? 0) <= 55; i++) v = v * 8 + (this.buf[this.pos++]! - 48);
          out.push(v & 255);
        } else out.push(c);
      } else if (c === 40) { depth++; out.push(c); }
      else if (c === 41) { depth--; if (depth > 0) out.push(c); }
      else out.push(c);
    }
    return new Str(Buffer.from(out));
  }
  hexString(): Str {
    this.pos++;
    let h = '';
    for (;;) {
      const c = this.byte();
      this.pos++;
      if (c === 62) break;
      if (WS.has(c)) continue;
      if (!/[0-9a-fA-F]/.test(String.fromCharCode(c))) return damaged('hex');
      h += String.fromCharCode(c);
      if (h.length > MAX_STR * 2) return damaged('string');
    }
    return new Str(Buffer.from(h.length % 2 ? h + '0' : h, 'hex'));
  }
  dict(depth: number): Dict {
    this.pos += 2;
    const d: Dict = new Map();
    for (;;) {
      this.skipWs();
      const c = this.byte();
      if (c === 62) {
        if (this.buf[this.pos + 1] === undefined) throw new Eof();
        if (this.buf[this.pos + 1] !== 62) return damaged('dict');
        this.pos += 2;
        return d;
      }
      if (c !== 47) return damaged('dict-key');
      const k = this.name().v;
      d.set(k, this.value(depth + 1));
    }
  }
  /** `N G obj <value> [stream]` at the current position. */
  indirect(): Indirect {
    const num = Number(this.word()), gen = Number(this.word());
    if (!Number.isInteger(num) || !Number.isInteger(gen) || this.word() !== 'obj') return damaged('obj-header');
    const val = this.value();
    let dataStart = -1;
    if (val instanceof Map) {
      this.skipWs();
      if (this.buf.toString('latin1', this.pos, this.pos + 6) === 'stream') {
        let p = this.pos + 6;
        if (this.buf[p] === 13) p++;
        if (this.buf[p] === 10) p++;
        dataStart = this.base + p;
      }
    }
    return { num, gen, val, dataStart };
  }
}

const NAME_BAD = /[^!-~]|[()<>[\]{}/%#]/;
export function ser(v: Val, out: string[] = []): string {
  if (v === null) out.push('null');
  else if (typeof v === 'boolean') out.push(v ? 'true' : 'false');
  else if (typeof v === 'number') out.push(Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/\.?0+$/, ''));
  else if (v instanceof Name) out.push('/' + [...v.v].map((ch) => (NAME_BAD.test(ch) ? '#' + ch.charCodeAt(0).toString(16).padStart(2, '0') : ch)).join(''));
  else if (v instanceof Ref) out.push(`${v.n} ${v.g} R`);
  else if (v instanceof Str) out.push('<' + v.b.toString('hex') + '>');
  else if (Array.isArray(v)) { out.push('['); v.forEach((x, i) => { if (i) out.push(' '); ser(x, out); }); out.push(']'); }
  else { out.push('<<'); for (const [k, x] of v) { ser(new Name(k), out); out.push(' '); ser(x, out); out.push(' '); } out.push('>>'); }
  return out.join('');
}

export const asDict = (v: Val | undefined): Dict | undefined => (v instanceof Map ? v : undefined);
export const asNum = (v: Val | undefined): number | undefined => (typeof v === 'number' ? v : undefined);
export const nameOf = (v: Val | undefined): string | undefined => (v instanceof Name ? v.v : undefined);

/** Text string to PDF syntax: literal for ASCII, UTF-16BE with BOM otherwise. */
export function pdfText(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, '\\$&') + ')';
  const b = Buffer.from('﻿' + s, 'utf16le').swap16();
  return '<' + b.toString('hex') + '>';
}
