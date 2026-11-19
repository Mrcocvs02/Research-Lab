import { describe, expect, it } from 'vitest';
import { documentRecordSchema } from '@rl/core';
import { bibtexEntry, safeKey } from './bibtex-write.js';
import { cslFile, risFile } from './refs.js';

const doc = documentRecordSchema.parse({ schemaVersion: 1, id: '0123456789abcdef', hash: 'a'.repeat(64), path: 'p.pdf', size: 1, mtimeMs: 1, addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', title: 'T' });
const HOSTILE = 'x,\n  author = {evil}}\n@misc{y';

describe('cite keys written to files', () => {
  it('keeps ordinary keys and replaces what could end the entry or add a field', () => {
    expect(safeKey('smith2020:deep-learning.v2')).toBe('smith2020:deep-learning.v2');
    expect(safeKey(HOSTILE)).not.toMatch(/[,{}\s=@]/);
    expect(safeKey('')).toBe('key');
  });
  it('a hostile key cannot inject a field in BibTeX, RIS or CSL', () => {
    const bib = bibtexEntry(doc, HOSTILE);
    expect(bib.match(/@/g)).toHaveLength(1);
    expect(bib).not.toMatch(/^\s*author\s*=/m); // the hostile text stays inside the sanitised key, never a field of its own
    expect(bib.split('\n')[0]).not.toMatch(/[\s{},=]evil/);
    expect(risFile([{ doc, key: HOSTILE }])).not.toMatch(/\r\nAU/);
    expect((JSON.parse(cslFile([{ doc, key: HOSTILE }])) as Array<{ id: string }>)[0]!.id).toBe(safeKey(HOSTILE));
  });
});
