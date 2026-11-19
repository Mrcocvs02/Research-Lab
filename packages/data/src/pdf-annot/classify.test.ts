import { describe, expect, it } from 'vitest';
import { bufSource, classifyIncrement, readDict } from './classify.js';
import { HIGHLIGHT, PAGE_WITH_ANNOTS, acrobatStyle, appendRevision, basePdf, objStm, stream } from './test-pdfs.js';

const kind = (full: Buffer, oldSize: number) => classifyIncrement(bufSource(full), oldSize);

describe('classifyIncrement (D-350: the content of the revision, not who wrote it)', () => {
  const base = basePdf();

  it('an annotation and the page that lists it are "annotations" (ours or another program: same bytes)', async () => {
    expect(await kind(appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, HIGHLIGHT('rl-abc')]]), base.length)).toBe('annotations');
    expect(await kind(appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, HIGHLIGHT('from-another-computer')]]), base.length)).toBe('annotations');
  });

  it('Acrobat style (popup, appearance form, /Info and /Metadata) is "annotations"', async () => {
    expect(await kind(acrobatStyle(base), base.length)).toBe('annotations');
  });

  it('a second revision on top of the first is judged from where it starts', async () => {
    const v2 = appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, HIGHLIGHT('rl-1')]]);
    const v3 = appendRevision(v2, [[3, PAGE_WITH_ANNOTS('[5 0 R 6 0 R]')], [6, HIGHLIGHT('rl-2')]]);
    expect(await kind(v3, v2.length)).toBe('annotations');
    expect(await kind(v3, base.length)).toBe('annotations');
  });

  it('an annotation inside an object stream and an indirect /Annots array are "annotations"', async () => {
    const v2 = appendRevision(base, [[3, PAGE_WITH_ANNOTS('5 0 R')], [5, '[6 0 R]'], [7, objStm([[6, HIGHLIGHT('rl-z')]])]]);
    expect(await kind(v2, base.length)).toBe('annotations');
  });

  it('an annotation can be modified in a later revision (old definition found and of the same kind)', async () => {
    const v2 = appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, HIGHLIGHT('rl-1')]]);
    const v3 = appendRevision(v2, [[5, HIGHLIGHT('rl-1').replace('(note', '(changed')]]);
    expect(await kind(v3, v2.length)).toBe('annotations');
  });

  it('a new content stream for the page is "content"', async () => {
    const v2 = appendRevision(base, [[3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R >>'], [5, stream('', 'BT (Other) Tj ET')]]);
    expect(await kind(v2, base.length)).toBe('content');
    expect(await kind(appendRevision(base, [[5, stream('', 'BT (Other) Tj ET')]]), base.length)).toBe('content');
  });

  it('a page changed in more than /Annots, a new page, a font, a form field, a changed catalog are "content"', async () => {
    expect(await kind(appendRevision(base, [[3, PAGE_WITH_ANNOTS('[]').replace('[0 0 200 200]', '[0 0 300 300]')]]), base.length)).toBe('content');
    const newPage = appendRevision(base, [[2, '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'], [5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>']]);
    expect(await kind(newPage, base.length)).toBe('content');
    expect(await kind(appendRevision(base, [[5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']]), base.length)).toBe('content');
    expect(await kind(appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, '<< /Type /Annot /Subtype /Widget /FT /Tx /Rect [0 0 10 10] >>']]), base.length)).toBe('content');
    expect(await kind(appendRevision(base, [[1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] >> >>']]), base.length)).toBe('content');
  });

  it('an object that changes kind (the page contents replaced by an annotation) is "content"', async () => {
    expect(await kind(appendRevision(base, [[4, HIGHLIGHT('rl-evil')]]), base.length)).toBe('content');
  });

  it('only a Metadata change on the catalog is allowed', async () => {
    const ok = appendRevision(base, [[1, '<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R >>'], [5, stream('/Type /Metadata /Subtype /XML', '<x/>')]]);
    expect(await kind(ok, base.length)).toBe('annotations');
  });

  it('an object stream with a font in it is "content"', async () => {
    expect(await kind(appendRevision(base, [[5, objStm([[6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']])]]), base.length)).toBe('content');
  });

  it('data after %%EOF, no growth, truncation and garbage are "content" and never throw', async () => {
    expect(await kind(Buffer.concat([base, Buffer.from('trailing garbage')]), base.length)).toBe('content');
    expect(await kind(base, base.length)).toBe('content');
    const v2 = appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, HIGHLIGHT('rl-1')]]);
    expect(await kind(v2.subarray(0, v2.length - 30), base.length)).toBe('content');
    expect(await kind(Buffer.from('not a pdf'), 3)).toBe('content');
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 100; i++) {
      const b = Buffer.from(v2);
      for (let k = 0; k < 4; k++) b[base.length + rnd(v2.length - base.length)] = rnd(256);
      await expect(kind(b, base.length)).resolves.toMatch(/^(annotations|content)$/);
    }
  });

  it('reads a dictionary with nested values, strings with parentheses and references', () => {
    const r = readDict('<< /A [1 2 R (x\\)y)] /B << /C /D >> /Contents (note \\(1\\)) /Rect [1 2 3 4.5] >>', 0)!;
    expect(r.d.get('A')).toBe('[1 2 R (x\\)y)]');
    expect(r.d.get('B')).toBe('<< /C /D >>');
    expect(r.d.get('Rect')).toBe('[1 2 3 4.5]');
    expect(readDict('<< /A [1 2', 0)).toBeNull();
  });

  describe('the xref section of the added revision (M6)', () => {
    const region = (full: Buffer, from: number, edit: (t: string) => string) => Buffer.concat([full.subarray(0, from), Buffer.from(edit(full.subarray(from).toString('latin1')), 'latin1')]);
    const good = appendRevision(base, [[3, PAGE_WITH_ANNOTS('[5 0 R]')], [5, HIGHLIGHT('rl-abc')]]);

    it('an entry that points into old content instead of the object it names is "content"', async () => {
      const at = base.toString('latin1').indexOf('4 0 obj');
      const bad = region(good, base.length, (t) => t.replace(/5 1\n\d{10} 00000 n/, `5 1\n${String(at).padStart(10, '0')} 00000 n`));
      expect(await kind(good, base.length)).toBe('annotations');
      expect(await kind(bad, base.length)).toBe('content');
    });

    it('freeing a content object is "content"; freeing an annotation is not', async () => {
      expect(await kind(region(good, base.length, (t) => t.replace('xref\n', 'xref\n4 1\n0000000000 00001 f \n')), base.length)).toBe('content');
      const v3 = appendRevision(good, [[3, PAGE_WITH_ANNOTS('[]')]]);
      expect(await kind(region(v3, good.length, (t) => t.replace('xref\n', 'xref\n5 1\n0000000000 00001 f \n')), good.length)).toBe('annotations');
    });

    it('a changed or missing /Root in the new trailer is "content"', async () => {
      expect(await kind(region(good, base.length, (t) => t.replace('/Root 1 0 R', '/Root 2 0 R')), base.length)).toBe('content');
      expect(await kind(region(good, base.length, (t) => t.replace('/Root 1 0 R', '')), base.length)).toBe('content');
    });
  });
});
