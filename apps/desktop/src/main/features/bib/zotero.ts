import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { blank, cleanAuthors, cleanList, clip, LIMITS, normArxiv, normDoi, yearOf, type BibEntry, type BibRead } from './entry.js';

type Row = Record<string, string | number | bigint | null | Uint8Array>;
interface Db {
  prepare(sql: string): { all(...p: unknown[]): Row[] };
  close(): void;
}

const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'bigint' ? String(v) : '');

function htmlToText(h: string): string {
  return h
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

const SQL = {
  items: `SELECT i.itemID AS id, i.key AS key, t.typeName AS type FROM items i JOIN itemTypes t USING(itemTypeID)
          WHERE t.typeName NOT IN ('attachment','note','annotation') AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`,
  fields: `SELECT d.itemID AS id, f.fieldName AS name, v.value AS value FROM itemData d JOIN fields f USING(fieldID) JOIN itemDataValues v USING(valueID)`,
  creators: `SELECT ic.itemID AS id, ct.creatorType AS kind, c.firstName AS first, c.lastName AS last, c.fieldMode AS mode FROM itemCreators ic
             JOIN creators c USING(creatorID) JOIN creatorTypes ct USING(creatorTypeID) ORDER BY ic.itemID, ic.orderIndex`,
  tags: `SELECT it.itemID AS id, t.name AS name FROM itemTags it JOIN tags t USING(tagID)`,
  collections: `SELECT ci.itemID AS id, c.collectionName AS name FROM collectionItems ci JOIN collections c USING(collectionID)`,
  notes: `SELECT n.parentItemID AS id, n.note AS note FROM itemNotes n WHERE n.parentItemID IS NOT NULL AND n.itemID NOT IN (SELECT itemID FROM deletedItems)`,
  attachments: `SELECT a.parentItemID AS id, i.key AS key, a.linkMode AS mode, a.path AS path, a.contentType AS type FROM itemAttachments a JOIN items i ON i.itemID = a.itemID
                WHERE a.parentItemID IS NOT NULL AND a.itemID NOT IN (SELECT itemID FROM deletedItems)`,
};

const group = <T>(rows: Row[], pick: (r: Row) => T | null): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const v = pick(r);
    if (v === null) continue;
    const id = s(r['id']);
    const l = m.get(id);
    if (l) l.push(v);
    else m.set(id, [v]);
  }
  return m;
};

async function openDb(file: string, tmpRoot: string): Promise<{ db: Db; cleanup(): Promise<void> }> {
  const { DatabaseSync } = (await import('node:sqlite')) as unknown as { DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => Db };
  const probe = (db: Db) => db.prepare('SELECT count(*) AS n FROM items').all();
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    probe(db);
    return { db, cleanup: async () => db.close() };
  } catch {
    // Zotero keeps its database locked while it runs: read a copy made in the app's own local folder.
    const dir = await mkdtemp(path.join(tmpRoot, 'zotero-'));
    const copy = path.join(dir, 'zotero.sqlite');
    await copyFile(file, copy);
    for (const ext of ['-wal', '-shm']) await copyFile(file + ext, copy + ext).catch(() => undefined);
    const db = new DatabaseSync(copy, { readOnly: true });
    return {
      db,
      cleanup: async () => {
        db.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }
}

/** Reads a Zotero database (`zotero.sqlite`); attachments are looked for in the `storage` folder next to it. Only reads. */
export async function readZotero(file: string, tmpRoot: string): Promise<BibRead> {
  const base = path.dirname(file);
  const { db, cleanup } = await openDb(file, tmpRoot);
  try {
    const all = (sql: string) => db.prepare(sql).all();
    const items = all(SQL.items).slice(0, LIMITS.entries);
    const fields = group(all(SQL.fields), (r) => [s(r['name']), s(r['value'])] as const);
    const creators = group(all(SQL.creators), (r) => ({ kind: s(r['kind']), name: s(r['mode']) === '1' ? s(r['last']) : s(r['last']) && s(r['first']) ? `${s(r['last'])}, ${s(r['first'])}` : s(r['last']) || s(r['first']) }));
    const tags = group(all(SQL.tags), (r) => s(r['name']));
    const cols = group(all(SQL.collections), (r) => s(r['name']));
    const notes = group(all(SQL.notes), (r) => clip(htmlToText(s(r['note'])), LIMITS.notes));
    const atts = group(all(SQL.attachments), (r) => ({ key: s(r['key']), mode: Number(r['mode']), path: s(r['path']), type: s(r['type']) }));
    const entries: BibEntry[] = [];
    const skipped: BibRead['skipped'] = [];
    for (const it of items) {
      const id = s(it['id']);
      const f = new Map(fields.get(id) ?? []);
      const e: BibEntry = blank();
      e.title = clip(f.get('title'));
      const cs = creators.get(id) ?? [];
      const authors = cs.filter((c) => c.kind === 'author');
      e.authors = cleanAuthors((authors.length > 0 ? authors : cs.filter((c) => c.kind === 'editor')).map((c) => c.name));
      e.year = yearOf(f.get('date'));
      e.venue = clip(f.get('publicationTitle') ?? f.get('proceedingsTitle') ?? f.get('bookTitle') ?? f.get('seriesTitle') ?? f.get('websiteTitle'), 500);
      const vol = f.get('volume');
      const num = f.get('issue');
      const pages = f.get('pages');
      e.venueRef = clip([vol && `vol. ${vol}`, num && `no. ${num}`, pages && `pp. ${pages}`].filter(Boolean).join(', '), 500);
      const extra = f.get('extra') ?? '';
      e.doi = normDoi(f.get('DOI') ?? (/^DOI:\s*(\S+)/im.exec(extra)?.[1] ?? f.get('url')));
      e.arxivId = normArxiv(/arxiv/i.test(extra + (f.get('repository') ?? '') + (f.get('url') ?? '')) ? (/arXiv:\s*(\S+)/i.exec(extra)?.[1] ?? f.get('archiveID') ?? f.get('url')) : null);
      const ck = /^Citation Key:\s*(\S+)/im.exec(extra)?.[1];
      e.key = ck ?? null;
      e.tags = cleanList(tags.get(id) ?? []);
      e.collections = cleanList(cols.get(id) ?? []);
      e.notes = (notes.get(id) ?? []).filter((n): n is string => n !== null);
      for (const a of atts.get(id) ?? []) {
        // Linkmodes: 0/1 file in storage (`storage:name`), 2 linked file (absolute or `attachments:relative`); 3 is a URL.
        if (a.mode === 3 || a.path === '' || a.path.includes('\0')) continue;
        if (a.path.startsWith('storage:')) e.files.push(path.join(base, 'storage', a.key, a.path.slice(8)));
        else if (!a.path.startsWith('attachments:')) e.files.push(a.path);
      }
      if (e.title === null && e.authors.length === 0) skipped.push({ label: s(it['key']), reason: 'empty' });
      else entries.push(e);
    }
    return { source: 'zotero', entries, base, skipped: skipped.slice(0, 500) };
  } finally {
    await cleanup();
  }
}
