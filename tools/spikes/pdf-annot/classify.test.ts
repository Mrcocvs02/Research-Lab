import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { bufSource } from './doc';
import { encryptDictR3, handClassic, handEncrypt, handSigned, handXfa, libPdf } from './pdfs';
import { buildUpdate } from './writer';

const run = (b: Buffer) => classify(bufSource(b));
const refusal = (b: Buffer) => { const c = run(b); return c.ok ? 'ok' : `${c.reason}:${c.detail}`; };
const sx = (b: Buffer, to: string) => Buffer.from(b.toString('latin1').replace(/startxref\n\d+/, `startxref\n${to}`), 'latin1');

describe('classifier', () => {
  it('accepts plain files, with or without object streams, and counts data after %%EOF without refusing', async () => {
    expect(run(handClassic()).ok).toBe(true);
    expect(run(await libPdf({ objectStreams: true })).ok).toBe(true);
    const c = run(Buffer.concat([handClassic(), Buffer.from('\nGARBAGE-AFTER-EOF')]));
    expect(c.ok && c.trailingBytes).toBeGreaterThan(0);
  });

  it('refuses encrypted files by reason; an empty user password is told apart', () => {
    expect(refusal(handEncrypt(encryptDictR3(-4)))).toBe('encrypted:empty-password');
    expect(run(handEncrypt(encryptDictR3(-4)))).toMatchObject({ emptyPassword: true });
    expect(refusal(handEncrypt(encryptDictR3(-4 & ~32)))).toBe('permission:no-annotate-bit');
    expect(run(handEncrypt(encryptDictR3(-4, 'secret')))).toMatchObject({ reason: 'encrypted', emptyPassword: false });
    expect(refusal(handEncrypt('<< /Filter /Custom /V 1 /R 2 >>'))).toBe('encrypted:handler');
  });

  it('refuses signed files (a filled signature field), but not an empty signature field', () => {
    expect(refusal(handSigned(true))).toBe('signed:signature');
    expect(refusal(handSigned(false))).toBe('ok');
  });

  it('refuses XFA forms', () => expect(refusal(handXfa())).toBe('xfa:xfa'));

  it('refuses truncated files, wrong startxref, empty and non-PDF input as damaged', async () => {
    const good = handClassic();
    expect(refusal(good.subarray(0, Math.floor(good.length * 0.7)))).toMatch(/^damaged:/);
    expect(refusal(good.subarray(0, good.indexOf('startxref') - 3))).toBe('damaged:no-startxref');
    expect(refusal(sx(good, '999999'))).toBe('damaged:xref-offset');
    expect(refusal(sx(good, '12'))).toMatch(/^damaged:/);
    expect(refusal(Buffer.alloc(0))).toBe('damaged:no-startxref');
    expect(refusal(Buffer.from('not a pdf at all'))).toBe('damaged:no-startxref');
    const big = await libPdf({ pages: 3, objectStreams: true });
    expect(refusal(big.subarray(0, big.length - 40))).toMatch(/^damaged:/);
  });

  it('refuses a cyclic /Prev chain (self reference, and a loop through a written update)', () => {
    const first = handClassic({ trailerExtra: '/Prex 0000000000' });
    const xr = Number(/startxref\n(\d+)/.exec(first.toString('latin1'))![1]);
    expect(refusal(handClassic({ trailerExtra: `/Prev ${xr}` }))).toBe('damaged:prev-cycle');
    const c = run(first);
    if (!c.ok) throw new Error('setup');
    const u = buildUpdate(c.doc, { add: [{ nm: 'rl-x', subtype: 'Highlight', page: 0, rects: [[1, 1, 20, 20]], color: [1, 1, 0] }] });
    const two = Buffer.concat([first, u.bytes]);
    const xr2 = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(two.toString('latin1'))![1]);
    // Newest -> first -> newest: the first section's trailer gets /Prev pointing at the newest section (same length of text kept by padding).
    const text = two.toString('latin1');
    const patched = Buffer.from(text.replace('/Prex 0000000000', `/Prev ${String(xr2).padStart(10, '0')}`), 'latin1');
    expect(refusal(patched)).toBe('damaged:prev-cycle');
  });

  it('never throws on random truncations and byte flips (mutation smoke test)', async () => {
    const base = [await libPdf({ pages: 2, objectStreams: true }), await libPdf({ pages: 2 })];
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 300; i++) {
      const b = Buffer.from(base[i % 2]!);
      if (i % 3 === 0) { run(b.subarray(0, rnd(b.length))); continue; }
      for (let k = 0; k < 1 + rnd(6); k++) b[b.length - 1 - rnd(Math.min(b.length, 1500))] = rnd(256);
      const c = run(b);
      if (c.ok) {
        try { buildUpdate(c.doc, { add: [{ nm: 'rl-m', subtype: 'Underline', page: 0, rects: [[1, 1, 20, 20]], color: [1, 0, 0] }] }); } catch (e) { expect((e as Error).name).toBe('Error'); expect((e as { kind?: string }).kind).toBeDefined(); }
      }
    }
  });
});
