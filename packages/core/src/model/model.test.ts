import { describe, expect, it } from 'vitest';
import { documentIdFromHash } from '../common.js';
import { dataPath } from '../data-paths.js';
import { aiFieldSchema } from './ai-field.js';
import { documentRecordSchema } from './document.js';
import { legacyFileRecordSchema, legacyTaxonomySchema } from './legacy-index.js';
import { logEntrySchema } from './log-entry.js';
import { noteSchema } from './note.js';
import { taxonomyFileSchema } from './taxonomy.js';
import { z } from 'zod';

const HASH = 'ab'.repeat(32);
const NOW = '2026-01-01T00:00:00Z';

describe('document record', () => {
  const minimal = { id: documentIdFromHash(HASH), hash: HASH, path: 'a/b.pdf', size: 1, mtimeMs: 1, addedAt: NOW, updatedAt: NOW };

  it('derives a stable id from the hash prefix', () => {
    expect(documentIdFromHash(HASH)).toBe('abababababababab');
    expect(documentIdFromHash(HASH.toUpperCase())).toBe('abababababababab');
  });

  it('fills defaults: study to-read, not underlined, empty AI', () => {
    const d = documentRecordSchema.parse(minimal);
    expect(d.study.state).toBe('to-read');
    expect(d.study.underlined).toEqual({ value: false, origin: 'manual' });
    expect(d.ai).toEqual({});
    expect(d.tags).toEqual([]);
    expect(d.previousHashes).toEqual([]);
  });

  it('refuses absolute and traversing paths', () => {
    expect(() => documentRecordSchema.parse({ ...minimal, path: 'C:/x.pdf' })).toThrow();
    expect(() => documentRecordSchema.parse({ ...minimal, path: '../x.pdf' })).toThrow();
    expect(() => documentRecordSchema.parse({ ...minimal, path: '/x.pdf' })).toThrow();
    expect(() => documentRecordSchema.parse({ ...minimal, path: 'a\\b.pdf' })).toThrow();
  });

  it('keeps AI output inside wrapped fields only', () => {
    const wrapped = {
      value: 'sum',
      meta: { model: 'claude-haiku-5-5', provider: 'mock', date: NOW, source: 'describe' },
      review: { status: 'proposed' },
    };
    const d = documentRecordSchema.parse({ ...minimal, ai: { summary: wrapped } });
    expect(d.ai.summary?.review.status).toBe('proposed');
    expect(() => documentRecordSchema.parse({ ...minimal, ai: { summary: 'bare string' } })).toThrow();
  });

  it('aiField requires model metadata', () => {
    const f = aiFieldSchema(z.string());
    expect(() => f.parse({ value: 'x', review: { status: 'proposed' } })).toThrow();
  });
});

describe('notes and logs', () => {
  it('page notes need a page', () => {
    const fm = { docId: documentIdFromHash(HASH), scope: 'page', createdAt: NOW, updatedAt: NOW };
    expect(() => noteSchema.parse({ frontmatter: fm, body: '' })).toThrow();
    expect(noteSchema.parse({ frontmatter: { ...fm, page: 3 }, body: 'x' }).frontmatter.page).toBe(3);
  });

  it('log entries are discriminated', () => {
    expect(
      logEntrySchema.parse({ type: 'change', at: NOW, deviceId: 'd1', actor: 'user', target: { kind: 'document', id: 'x' }, action: 'tag.add' }).type,
    ).toBe('change');
    expect(() => logEntrySchema.parse({ type: 'ai-send', at: NOW, deviceId: 'd1' })).toThrow();
  });

  it('data paths are relative to the data dir and per-device for logs', () => {
    expect(dataPath.document('abc')).toBe('documents/abc.json');
    expect(dataPath.pageNote('abc', 4)).toBe('notes/abc/p4.md');
    expect(dataPath.logFile('changes', 'dev1', '2026-01')).toBe('log/changes-2026-01.dev1.jsonl');
  });
});

describe('legacy index shapes', () => {
  it('parses a synthetic files.jsonl record and keeps unknown keys', () => {
    const rec = legacyFileRecordSchema.parse({
      p: 'dir/file.pdf',
      mt: 1,
      sz: 10,
      h: '',
      first: '2024-01-01',
      tagged: true,
      st: 'x',
      future_field: 1,
      tags: { title: 'T', authors: ['A B'], macro: ['m'], micro: ['u'], extra: ['e'], year: 2020, doi: null, mystery: 7 },
    });
    expect((rec as Record<string, unknown>).future_field).toBe(1);
    expect(rec.tags?.macro).toEqual(['m']);
  });

  it('parses a synthetic taxonomy.json', () => {
    const t = legacyTaxonomySchema.parse({
      version: 3,
      settings: { self_names: ['A B'], extensions: ['pdf'], name_only_extensions: [], prune_deleted_days: 30 },
      venues: { J: { aliases: ['Journal'] } },
      types: ['paper'],
      macro: { M: { aliases: [] } },
      micro: { u: { macro: ['M'], aliases: ['uu'], status: 'ok', implies: [] } },
      extra: { e: { group: 'g', source: 's', added: '2024' } },
      imports_done: [],
    });
    expect(Object.keys(t.micro ?? {})).toEqual(['u']);
  });

  it('taxonomy file allows multiple parents and free depth', () => {
    const t = taxonomyFileSchema.parse({
      nodes: [
        { id: 'root', label: 'Root' },
        { id: 'a', label: 'A', parents: ['root'] },
        { id: 'b', label: 'B', parents: ['root', 'a'], implies: ['a'] },
      ],
    });
    expect(t.nodes[2]?.parents).toEqual(['root', 'a']);
    expect(t.nodes[0]?.status).toBe('active');
  });
});
