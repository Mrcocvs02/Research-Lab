import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '@rl/core';
import { overlapRatio, repairQuotes, type NormRect, type QuoteQuery } from './extract/pdf-geometry.js';
import { removeDir, tempDir } from './test-utils.js';

/** Synthetic pages: the lines are drawn at known positions, so the glyph box of any quoted piece is known exactly. */
const W = 612;
const H = 792;
const SIZE = 12;
const LEFT = 72;
const LINES: Array<{ text: string; y: number }> = [
  { text: 'The committee reviewed the proposal in detail', y: 700 },
  { text: 'and approved the revised schedule without delay', y: 684 },
  { text: 'Results were stable across every single trial', y: 500 },
  { text: 'Twice the same words, twice the same words', y: 300 },
  { text: 'A recurring phrase sits near the top', y: 650 },
  { text: 'Filler text without anything special', y: 400 },
  { text: 'A recurring phrase sits near the top', y: 150 },
];

let dir: string;
let font: Awaited<ReturnType<PDFDocument['embedFont']>>;

async function makePdf(file: string, rotate = 0): Promise<void> {
  const doc = await PDFDocument.create();
  font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([W, H]);
  if (rotate) page.setRotation(degrees(rotate));
  for (const l of LINES) page.drawText(l.text, { x: LEFT, y: l.y, size: SIZE, font });
  await writeFile(file, await doc.save());
}

/** The glyph box of `piece` inside line `line` (fractions of the page, y from the top): baseline minus cap height down to the descender. */
function glyphBox(line: number, piece: string): NormRect {
  const l = LINES[line]!;
  const before = font.widthOfTextAtSize(l.text.slice(0, l.text.indexOf(piece)), SIZE);
  const w = font.widthOfTextAtSize(piece, SIZE);
  const top = H - l.y - 0.72 * SIZE;
  return { x: (LEFT + before) / W, y: top / H, w: w / W, h: (0.93 * SIZE) / H };
}

/** What a stretched page saved: x measured against a box that was too narrow (factor 1.49, then limited to 1). */
function skewed(r: NormRect): NormRect {
  const x = Math.min(1, r.x * 1.49);
  return { x, y: r.y, w: Math.min(1 - x, r.w * 1.49), h: r.h };
}

const query = (id: string, page: number, text: string, line: number, piece: string): QuoteQuery => ({ id, page, text, rects: [skewed(glyphBox(line, piece))] });

beforeAll(async () => {
  dir = await tempDir('rl-geom-');
  await makePdf(path.join(dir, 'plain.pdf'));
  await makePdf(path.join(dir, 'rotated.pdf'), 90);
});
afterAll(() => removeDir(dir));

describe('repairQuotes on synthetic pages', () => {
  it('puts misplaced rectangles back on the glyphs (overlap >= 90%)', async () => {
    const queries = [
      query('a', 1, 'reviewed the proposal', 0, 'reviewed the proposal'),
      query('b', 1, 'approved the revised schedule', 1, 'approved the revised schedule'),
      query('c', 1, 'Results were stable', 2, 'Results were stable'),
      query('d', 1, 'trial', 2, 'trial'),
      // The quote is not what the page has, letter for letter: case, spaces and a line-end hyphen do not matter.
      query('e', 1, 'RESULTS  were sta- ble', 2, 'Results were stable'),
    ];
    const out = await repairQuotes(dir, 'plain.pdf', queries);
    expect(out).toHaveLength(queries.length);
    const truth = [glyphBox(0, 'reviewed the proposal'), glyphBox(1, 'approved the revised schedule'), glyphBox(2, 'Results were stable'), glyphBox(2, 'trial'), glyphBox(2, 'Results were stable')];
    out.forEach((o, i) => {
      expect(o.status, queries[i]!.id).toBe('found');
      if (o.status !== 'found') return;
      expect(o.unchanged).toBe(false);
      expect(overlapRatio(o.rects, [truth[i]!]), `overlap of ${o.id}`).toBeGreaterThanOrEqual(0.9);
    });
  });

  it('follows a quote over two lines', async () => {
    const q: QuoteQuery = { id: 'm', page: 1, text: 'proposal in detail and approved the revised', rects: [skewed(glyphBox(0, 'proposal in detail')), skewed(glyphBox(1, 'and approved the revised'))] };
    const [o] = await repairQuotes(dir, 'plain.pdf', [q]);
    expect(o?.status).toBe('found');
    if (o?.status !== 'found') return;
    expect(o.rects).toHaveLength(2);
    expect(overlapRatio(o.rects, [glyphBox(0, 'proposal in detail'), glyphBox(1, 'and approved the revised')])).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps rectangles that are already right (only the marker is needed)', async () => {
    const q: QuoteQuery = { id: 'r', page: 1, text: 'reviewed the proposal', rects: [glyphBox(0, 'reviewed the proposal')] };
    const [o] = await repairQuotes(dir, 'plain.pdf', [q]);
    expect(o).toMatchObject({ status: 'found', unchanged: true });
  });

  it('picks the occurrence closest to the saved vertical position', async () => {
    const top = query('t', 1, 'recurring phrase', 4, 'recurring phrase');
    const bottom = { ...query('u', 1, 'recurring phrase', 6, 'recurring phrase') };
    const out = await repairQuotes(dir, 'plain.pdf', [top, bottom]);
    expect(out[0]).toMatchObject({ status: 'found' });
    expect(out[1]).toMatchObject({ status: 'found' });
    if (out[0]?.status === 'found') expect(overlapRatio(out[0].rects, [glyphBox(4, 'recurring phrase')])).toBeGreaterThanOrEqual(0.9);
    if (out[1]?.status === 'found') expect(overlapRatio(out[1].rects, [glyphBox(6, 'recurring phrase')])).toBeGreaterThanOrEqual(0.9);
  });

  it('leaves the ambiguous and the unfound cases to the reader', async () => {
    const out = await repairQuotes(dir, 'plain.pdf', [
      query('amb', 1, 'the same words', 3, 'the same words'), // twice on one line: no position tells them apart
      { id: 'miss', page: 1, text: 'words that are nowhere on the page', rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.015 }] },
      { id: 'empty', page: 1, text: '   ', rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.015 }] },
      { id: 'far', page: 9, text: 'trial', rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.015 }] },
    ]);
    expect(out.map((o) => o.status)).toEqual(['ambiguous', 'none', 'none', 'none']);
  });

  it('works on a rotated page (the page box is the rotated one)', async () => {
    const q: QuoteQuery = { id: 'rot', page: 1, text: 'Results were stable', rects: [{ x: 0.5, y: 0.5, w: 0.01, h: 0.01 }] };
    const [o] = await repairQuotes(dir, 'rotated.pdf', [q]);
    expect(o?.status).toBe('found');
    if (o?.status !== 'found') return;
    // Rotated by 90 degrees clockwise: the line runs top to bottom; its box is narrow and tall.
    const r = o.rects[0]!;
    expect(r.h).toBeGreaterThan(r.w);
    expect(r.h * W).toBeGreaterThan(80);
  });

  it('reports pages as it goes, never writes, and stops on cancel', async () => {
    const seen: number[] = [];
    await repairQuotes(dir, 'plain.pdf', [query('a', 1, 'trial', 2, 'trial')], { onPage: (n) => seen.push(n) });
    expect(seen).toEqual([1]);
    const ac = new AbortController();
    ac.abort();
    await expect(repairQuotes(dir, 'plain.pdf', [query('a', 1, 'trial', 2, 'trial')], { signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('fails with a typed error for a file that is not a PDF', async () => {
    await writeFile(path.join(dir, 'bad.pdf'), 'not a pdf at all');
    const err = await repairQuotes(dir, 'bad.pdf', [query('a', 1, 'trial', 2, 'trial')]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).details?.['reason']).toBe('malformed');
  });
});
