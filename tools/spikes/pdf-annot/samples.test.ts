// Regenerates samples/*.pdf (opt-in: RL_S2_SAMPLES=1): small synthetic files to open by hand in Edge and Chrome.
// Each page says what to expect. They are also re-read here with pdf.js, so a committed sample is always a verified one.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { bufSource } from './doc';
import { annotsOf } from './pdfjs';
import { buildUpdate, type AnnotSpec, type Rect } from './writer';

const dir = join(import.meta.dirname, 'samples');
const FIXED = new Date('2026-01-01T00:00:00Z');

interface Sample { file: string; objectStreams: boolean; rotate?: number; crop?: [number, number, number, number]; marks: { text: string; y: number; kind?: 'Highlight' | 'Underline'; color?: [number, number, number]; note?: string }[]; title: string }

async function make(s: Sample): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([420, 300]);
  page.drawText(s.title, { x: 24, y: 270, size: 8, font });
  const specs: AnnotSpec[] = [];
  for (const m of s.marks) {
    page.drawText(m.text, { x: 30, y: m.y, size: 16, font });
    if (!m.kind) continue;
    const w = font.widthOfTextAtSize(m.text, 16);
    const r: Rect = [28, m.y - 4, 32 + w, m.y + 14];
    specs.push({ nm: `rl-sample-${specs.length}`, subtype: m.kind, page: 0, rects: [r], color: m.color ?? [1, 0.9, 0], contents: m.note });
  }
  if (s.rotate) page.setRotation(degrees(s.rotate));
  if (s.crop) page.setCropBox(...s.crop);
  const base = Buffer.from(await doc.save({ useObjectStreams: s.objectStreams }));
  const c = classify(bufSource(base));
  if (!c.ok) throw new Error('refused');
  const out = Buffer.concat([base, buildUpdate(c.doc, { add: specs }, FIXED).bytes]);
  const annots = await annotsOf(out);
  expect(annots.map((a) => a.subtype).sort()).toEqual(specs.map((a) => a.subtype).sort());
  expect(out.length).toBeLessThan(50_000);
  return out;
}

const SAMPLES: Sample[] = [
  { file: 'sample-1-classic.pdf', objectStreams: false, title: 'Classic xref table. Expect: YELLOW highlight on line 1, BLUE underline on line 2.',
    marks: [{ text: 'This line is highlighted yellow', y: 220, kind: 'Highlight' }, { text: 'This line is underlined blue', y: 180, kind: 'Underline', color: [0.1, 0.3, 1] }, { text: 'This line has no annotation', y: 140 }] },
  { file: 'sample-2-xref-stream.pdf', objectStreams: true, title: 'Xref stream + object streams. Expect: GREEN highlight, RED underline.',
    marks: [{ text: 'Green highlight here', y: 220, kind: 'Highlight', color: [0.2, 0.9, 0.3] }, { text: 'Red underline here', y: 180, kind: 'Underline', color: [0.9, 0.1, 0.1] }] },
  { file: 'sample-3-rotated-90.pdf', objectStreams: true, rotate: 90, title: 'Page rotated 90 degrees. Expect: PINK highlight and ORANGE underline following the text.',
    marks: [{ text: 'Pink highlight on rotated page', y: 220, kind: 'Highlight', color: [1, 0.4, 0.75] }, { text: 'Orange underline on rotated page', y: 180, kind: 'Underline', color: [1, 0.55, 0] }] },
  { file: 'sample-4-cropbox.pdf', objectStreams: false, crop: [10, 100, 330, 290], title: 'Shifted CropBox. Expect: YELLOW highlight and BLUE underline.',
    marks: [{ text: 'Highlight inside the crop', y: 220, kind: 'Highlight' }, { text: 'Underline inside the crop', y: 180, kind: 'Underline', color: [0.1, 0.3, 1] }] },
  { file: 'sample-5-comments.pdf', objectStreams: false, title: 'With comments (/Contents). Hover or open the annotation list: a comment must show.',
    marks: [{ text: 'Highlight with a comment', y: 220, kind: 'Highlight', color: [1, 0.9, 0], note: 'Comment on the highlight. Accents: caffe, perche, 100 percent.' }, { text: 'Underline with a comment', y: 180, kind: 'Underline', color: [0.5, 0.2, 0.8], note: 'Comment on the underline.' }] },
];

describe.skipIf(process.env.RL_S2_SAMPLES !== '1')('hand-check samples', () => {
  it('writes and verifies the sample files', async () => {
    mkdirSync(dir, { recursive: true });
    for (const s of SAMPLES) writeFileSync(join(dir, s.file), await make(s));
  });
});
