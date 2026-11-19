// R6 key hash (Algorithm 2.B of ISO 32000-2) against an implementation that this code did not write: pdf.js's own `PDF20._hash`
// (pdfjs-dist, already installed; no dependency added). The worker build only exports `WorkerMessageHandler`, so the class is taken by
// evaluating the built file as a function body: the trailing `export` is cut, `import.meta.url` is replaced by a literal, and the class is
// returned. Math.sumPrecise (used by pdf.js on bytes) is shimmed with a plain sum when the runtime lacks it, exact for 16 bytes.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { hash2B } from './crypt.js';

type Pdf20 = { _hash(password: Uint8Array, input: Uint8Array, userBytes: Uint8Array): Uint8Array };

function loadPdfJsHash(): Pdf20 {
  const file = createRequire(import.meta.url).resolve('pdfjs-dist/build/pdf.worker.mjs');
  const src = readFileSync(file, 'utf8').replaceAll('import.meta.url', '"file:///worker.mjs"').replace(/^export \{[^}]*\};?\s*$/m, '');
  const m = Math as unknown as { sumPrecise?: (a: ArrayLike<number>) => number };
  m.sumPrecise ??= (a) => Array.from(a).reduce((x, y) => x + y, 0);
  const Cls = new Function(`${src}\n;return PDF20;`)() as new () => Pdf20;
  return new Cls();
}

/** pdf.js hashes password + salt (+ user key) as the starting input, then the same rounds as the spec. */
const theirs = (impl: Pdf20, pw: Buffer, salt: Buffer, u: Buffer) => Buffer.from(impl._hash(pw, Buffer.concat([pw, salt, u]), u));

describe('hash2B against pdf.js PDF20 (independent implementation)', () => {
  const impl = loadPdfJsHash();
  const salt = Buffer.from('0123456789abcdef'.slice(0, 8));
  const u48 = Buffer.from(Array.from({ length: 48 }, (_, i) => (i * 7 + 3) & 255));

  for (const len of [0, 1, 32, 127]) {
    it(`password of ${len} bytes, user password (no /U data) and owner (with the 48 bytes of /U)`, () => {
      const pw = Buffer.from(Array.from({ length: len }, (_, i) => (i * 31 + 5) & 255));
      expect(hash2B(pw, salt).equals(theirs(impl, pw, salt, Buffer.alloc(0)))).toBe(true);
      expect(hash2B(pw, salt, u48).equals(theirs(impl, pw, salt, u48))).toBe(true);
    });
  }

  it('random inputs agree', () => {
    for (let i = 0; i < 25; i++) {
      const pw = randomBytes(i % 128);
      const s = randomBytes(8);
      const u = i % 2 ? randomBytes(48) : Buffer.alloc(0);
      expect(hash2B(pw, s, u).equals(theirs(impl, pw, s, u))).toBe(true);
    }
  });
});
