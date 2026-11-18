// Double drawing (design 8.3.7): can the canvas of pdf.js skip OUR annotations while still drawing the foreign ones?
// Measured on the operator list: beginAnnotation operations are what pdf.js paints for annotations.
import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { bufSource } from './doc';
import { handForeignHighlight } from './pdfs';
import { withPdfjs } from './pdfjs';
import { buildUpdate, listOurs } from './writer';

function fileWithBoth(): { out: Buffer; objNum: number; gen: number } {
  const base = handForeignHighlight();
  const c = classify(bufSource(base));
  if (!c.ok) throw new Error('setup');
  const u = buildUpdate(c.doc, { add: [{ nm: 'rl-mine', subtype: 'Highlight', page: 0, rects: [[40, 300, 200, 320]], color: [1, 0.9, 0] }] });
  const out = Buffer.concat([base, u.bytes]);
  const c2 = classify(bufSource(out));
  if (!c2.ok) throw new Error('setup2');
  const ours = listOurs(c2.doc, 0)[0]!;
  return { out, objNum: ours.ref.n, gen: ours.ref.g };
}

describe('double drawing options', () => {
  it('(a)/(b) the annotationStorage hides our annotations by id on the canvas, keeping foreign ones; ids come from the stored object number', async () => {
    const { out, objNum, gen } = fileWithBoth();
    const res = await withPdfjs(out, async (doc, pdfjs) => {
      const page = await doc.getPage(1);
      const count = async (mode: number) => {
        const ol = await page.getOperatorList({ annotationMode: mode });
        return ol.fnArray.filter((f: number) => f === pdfjs.OPS.beginAnnotation).length;
      };
      const annots = await page.getAnnotations();
      const ids = annots.map((a: { id: string }) => a.id);
      const all = await count(pdfjs.AnnotationMode.ENABLE);
      const none = await count(pdfjs.AnnotationMode.DISABLE);
      const ourId = `${objNum}R${gen ? gen : ''}`;
      doc.annotationStorage.setValue(ourId, { noView: true });
      const hidden = await count(pdfjs.AnnotationMode.ENABLE_STORAGE);
      return { ids, all, none, hidden, ourId, keys: Object.keys(annots[0] ?? {}).filter((k) => /nm|name|unique/i.test(k)) };
    });
    expect(res.ids).toContain(res.ourId);
    expect(res.none).toBe(0); // option (b) with a mode switch would hide the foreign ones too
    expect(res.all).toBe(2);
    expect(res.hidden).toBe(1); // ours skipped, the foreign one still painted
    console.log('DOUBLEDRAW', JSON.stringify(res));
  });
});
