import { describe, expect, it } from 'vitest';
import { Lexer, Name, PdfError, Ref, Str, asDict, pdfText, ser, type Dict, type Val } from './objects.js';

/** Parses one value; a trailing space keeps the last token from touching the end of the window. */
const val = (s: string): Val => new Lexer(Buffer.from(s + ' ', 'latin1')).value();
const codeOf = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof PdfError ? e.code : `other:${String(e)}`;
  }
  return undefined;
};

describe('lexer: values (§8.3.13)', () => {
  it('numbers: integers, signs, reals and a leading dot', () => {
    expect(val('42')).toBe(42);
    expect(val('-3.5')).toBe(-3.5);
    expect(val('+7')).toBe(7);
    expect(val('.5')).toBe(0.5);
    expect(val('0')).toBe(0);
  });

  it('literals and keywords', () => {
    expect(val('true')).toBe(true);
    expect(val('false')).toBe(false);
    expect(val('null')).toBe(null);
  });

  it('references need two integers and an R that ends the token', () => {
    const r = val('12 0 R');
    expect(r).toBeInstanceOf(Ref);
    expect([(r as Ref).n, (r as Ref).g]).toEqual([12, 0]);
    // "1 2 Rx" is not a reference: the 1 is a number
    expect(val('1 2 Rx')).toBe(1);
    const a = val('[1 2 R 3]') as Val[];
    expect(a).toHaveLength(2);
    expect(a[0]).toBeInstanceOf(Ref);
    expect(a[1]).toBe(3);
  });

  it('literal strings: escapes, nesting, octal, line continuation', () => {
    const s = (v: Val) => (v as Str).b.toString('latin1');
    expect(s(val('(a\\(b\\)c)'))).toBe('a(b)c');
    expect(s(val('(a(b)c)'))).toBe('a(b)c');
    expect(s(val('(\\101\\102\\7)'))).toBe('AB\x07');
    expect(s(val('(l1\\nl2\\\\)'))).toBe('l1\nl2\\');
    expect(s(val('(one\\\ntwo)'))).toBe('onetwo');
    expect(s(val('(\\053)'))).toBe('+');
  });

  it('hexadecimal strings, with whitespace and an odd number of digits', () => {
    expect((val('<48 65 6C6c6F>') as Str).b.toString('latin1')).toBe('Hello');
    expect((val('<7>') as Str).b[0]).toBe(0x70);
    expect(codeOf(() => val('<4G>'))).toBe('hex');
  });

  it('names: #xx escapes', () => {
    expect((val('/A#20B') as Name).v).toBe('A B');
    expect((val('/Name') as Name).v).toBe('Name');
    expect((val('/') as Name).v).toBe('');
  });

  it('dictionaries with comments, nested values and references', () => {
    const d = asDict(val('<< /A 1 % a comment\n /B [true false null] /C << /D (x) >> /E 5 0 R >>'))!;
    expect(d.get('A')).toBe(1);
    expect(d.get('B')).toEqual([true, false, null]);
    expect(asDict(d.get('C'))!.get('D')).toBeInstanceOf(Str);
    expect(d.get('E')).toBeInstanceOf(Ref);
  });

  it('an indirect object: header, value and the start of a stream', () => {
    const buf = Buffer.from('7 0 obj\n<< /Length 3 >>\nstream\nabc\nendstream\nendobj\n', 'latin1');
    const ind = new Lexer(buf, 0, 100).indirect();
    expect([ind.num, ind.gen]).toEqual([7, 0]);
    expect(buf.toString('latin1', ind.dataStart - 100, ind.dataStart - 100 + 3)).toBe('abc');
    const plain = new Lexer(Buffer.from('3 1 obj\n[1 2]\nendobj\n', 'latin1')).indirect();
    expect(plain.gen).toBe(1);
    expect(plain.dataStart).toBe(-1);
  });

  it('refuses what is not PDF syntax', () => {
    expect(codeOf(() => val('<< /A >'))).toBeDefined();
    expect(codeOf(() => val('<< 1 2 >>'))).toBe('dict-key');
    expect(codeOf(() => val('zzz'))).toBe('token');
    expect(codeOf(() => val('(open'))).toBeDefined();
  });
});

describe('lexer: hostile limits (§8.3.12)', () => {
  it('nesting deeper than 64 is refused, not recursed into', () => {
    expect(codeOf(() => val('['.repeat(70) + ']'.repeat(70)))).toBe('depth');
    expect(codeOf(() => val('<< /A '.repeat(70) + '1' + ' >>'.repeat(70)))).toBe('depth');
    expect(codeOf(() => val('['.repeat(60) + ']'.repeat(60)))).toBeUndefined();
  });

  it('strings and names longer than 64 KiB are refused', () => {
    expect(codeOf(() => val('(' + 'a'.repeat(70_000) + ')'))).toBe('string');
    expect(codeOf(() => val('<' + 'ab'.repeat(70_000) + '>'))).toBe('string');
    expect(codeOf(() => val('/' + 'n'.repeat(70_000)))).toBe('name');
  });

  it('a token cut by the end of the window asks for more bytes instead of guessing', () => {
    expect(() => new Lexer(Buffer.from('<< /A 12', 'latin1')).value()).toThrow();
    const cut = (() => {
      try {
        new Lexer(Buffer.from('<< /A 12', 'latin1')).value();
      } catch (e) {
        return (e as PdfError).code;
      }
      return '';
    })();
    expect(cut).toBe('eof');
  });
});

describe('serializer', () => {
  it('writes every value kind so that the lexer reads it back', () => {
    const d: Dict = new Map<string, Val>([
      ['Name', new Name('A B/c')],
      ['Int', 5],
      ['Real', 1.5],
      ['Tiny', 0.1 + 0.2],
      ['Neg', -2],
      ['Ref', new Ref(9, 1)],
      ['Str', new Str(Buffer.from('a(b)\\\n'))],
      ['Arr', [1, new Name('X'), null, true]],
      ['Dict', new Map<string, Val>([['K', 1]])],
    ]);
    const text = ser(d);
    expect(text).toContain('/Name /A#20B#2fc');
    expect(text).toContain('/Real 1.5');
    expect(text).toContain('/Tiny 0.3');
    expect(text).toContain('/Ref 9 1 R');
    const back = asDict(val(text))!;
    expect((back.get('Name') as Name).v).toBe('A B/c');
    expect(back.get('Tiny')).toBe(0.3);
    expect((back.get('Str') as Str).b.toString('latin1')).toBe('a(b)\\\n');
    expect(back.get('Arr')).toEqual([1, expect.any(Name), null, true]);
    expect((back.get('Ref') as Ref).g).toBe(1);
  });
});

describe('pdfText: text strings written into the PDF (§8.3.2)', () => {
  it('ASCII is a literal with parentheses and backslashes escaped', () => {
    expect(pdfText('plain')).toBe('(plain)');
    expect(pdfText('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)');
  });

  it('everything else is UTF-16BE with a byte order mark, hexadecimal', () => {
    expect(pdfText('é')).toBe('<feff00e9>');
    expect(pdfText('日本')).toBe('<feff65e5672c>');
    expect(pdfText('😀')).toBe('<feffd83dde00>');
    expect(pdfText('a\nb')).toMatch(/^<feff/); // a newline is not in the ASCII printable range
  });
});
