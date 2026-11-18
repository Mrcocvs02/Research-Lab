import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { documentRecordSchema, type DocumentRecord } from '@rl/core';
import { readBibtex, unlatex } from './bibtex.js';
import { bibtexEntry, bibtexFile, esc, GENERATED_LINE } from './bibtex-write.js';
import { readCsl } from './csl.js';
import { normArxiv, normDoi } from './entry.js';
import { mergeFields } from './importer.js';
import { freeKey } from './keys.js';
import { buildIndex, resolveEntry } from './match.js';
import { readRdf } from './rdf.js';
import { readZotero } from './zotero.js';

// All fixtures are synthetic: invented authors, titles and paths.

const doc = (over: Partial<DocumentRecord> = {}): DocumentRecord =>
  documentRecordSchema.parse({ schemaVersion: 1, id: '0123456789abcdef', hash: 'a'.repeat(64), path: 'papers/one.pdf', size: 10, mtimeMs: 1, addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over });

const BIB = String.raw`
% a comment
@string{jx = "Journal of Synthetic Examples"}
@comment{ignored { nested } }
@article{ada2020graphs,
  author = {Lovelace, Ada and Doe, Jane and {Example Lab}},
  title = {Graphs of {DNA} and {\"u}ber-nodes},
  journal = jx,
  year = 2020,
  volume = {12}, number = {3}, pages = {10--20},
  doi = {https://doi.org/10.1234/ABC.5},
  keywords = {graphs; testing, synthetic},
  annote = {A note\nwith text},
  file = {Full text:files/one.pdf:application/pdf;Other:C\:\files\two.pdf:application/pdf}
}
@misc{preprint1,
  title = "A preprint " # "title",
  author = "Roe, Rick",
  year = {2021},
  eprint = {2101.01234},
  archiveprefix = {arXiv}
}
@book{ , }
`;

describe('BibTeX reader', () => {
  const r = readBibtex(BIB, '/base');
  it('reads entries, macros, concatenation and skips comments', () => {
    expect(r.entries).toHaveLength(2);
    const a = r.entries[0]!;
    expect(a.key).toBe('ada2020graphs');
    expect(a.venue).toBe('Journal of Synthetic Examples');
    expect(a.year).toBe(2020);
    expect(a.authors).toEqual(['Lovelace, Ada', 'Doe, Jane', 'Example Lab']);
    expect(a.title).toBe('Graphs of DNA and über-nodes');
    expect(a.venueRef).toBe('vol. 12, no. 3, pp. 10–20');
    expect(a.doi).toBe('10.1234/abc.5');
    expect(a.tags).toEqual(['graphs', 'testing', 'synthetic']);
    expect(r.entries[1]!.title).toBe('A preprint title');
    expect(r.entries[1]!.arxivId).toBe('2101.01234');
  });
  it('splits the file field and keeps a drive letter', () => {
    expect(r.entries[0]!.files).toEqual(['files/one.pdf', 'C:\\files\\two.pdf']);
  });
  it('skips empty entries with a reason and survives garbage', () => {
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.reason).toBe('empty');
    expect(() => readBibtex('@article{x, title = {unclosed', '/b')).not.toThrow();
    expect(readBibtex('no entries here', '/b').entries).toEqual([]);
  });
  it('converts LaTeX text', () => {
    expect(unlatex(String.raw`M{\"u}ller \& Fran\c{c}ois, {\ss}`)).toBe('Müller & François, ß');
  });
});

describe('BibTeX writer', () => {
  it('escapes specials and keeps balanced braces', () => {
    expect(esc('50% of A_B & {C}')).toBe('50\\% of A\\_B \\& {C}');
    expect(esc('open { brace')).toBe('open \\{ brace');
  });
  it('writes the generated line first, entries in key order, and reads back', () => {
    const a = doc({ title: 'Alpha study', authors: ['Roe, Rick'], year: 2020, ref: { venue: 'Synthetic Conference Proceedings' }, doi: '10.1/x' });
    const b = doc({ id: 'fedcba9876543210', title: 'Beta', authors: ['Doe, Jane'], year: null, arxivId: '2101.01234' });
    const text = bibtexFile([
      { doc: b, key: 'zzz' },
      { doc: a, key: 'aaa' },
    ]);
    expect(text.split('\n')[0]).toBe(GENERATED_LINE);
    expect(text.indexOf('@inproceedings{aaa')).toBeLessThan(text.indexOf('@misc{zzz'));
    const back = readBibtex(text, '/b').entries;
    expect(back.map((e) => e.key)).toEqual(['aaa', 'zzz']);
    expect(back[0]!.title).toBe('Alpha study');
    expect(back[1]!.arxivId).toBe('2101.01234');
    expect(bibtexEntry(a, 'k')).toContain('booktitle = {Synthetic Conference Proceedings}');
  });
});

describe('CSL JSON reader', () => {
  it('reads items and refuses garbage', () => {
    const r = readCsl(JSON.stringify([{ id: 'k1', title: 'Synthetic CSL', author: [{ family: 'Roe', given: 'Rick' }, { literal: 'Lab Group' }], issued: { 'date-parts': [[2019, 5]] }, 'container-title': 'Venue', DOI: '10.5555/Z', keyword: 'a, b', volume: '3', page: '1-2' }, { id: 'http://x/1' }]), '/b');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ key: 'k1', year: 2019, authors: ['Roe, Rick', 'Lab Group'], doi: '10.5555/z', tags: ['a', 'b'], venueRef: 'vol. 3, pp. 1-2' });
    expect(r.skipped).toHaveLength(1);
    expect(readCsl('not json', '/b').skipped[0]!.reason).toBe('invalid');
  });
});

describe('Zotero RDF reader', () => {
  const xml = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:bib="http://purl.org/net/biblio#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:z="http://www.zotero.org/namespaces/export#" xmlns:foaf="http://xmlns.com/foaf/0.1/" xmlns:link="http://purl.org/rss/1.0/modules/link/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:prism="http://prismstandard.org/namespaces/1.2/basic/">
 <bib:Article rdf:about="#item_1">
  <dc:title>Synthetic &amp; RDF</dc:title>
  <bib:authors><rdf:Seq><rdf:li><foaf:Person><foaf:surname>Roe</foaf:surname><foaf:givenName>Rick</foaf:givenName></foaf:Person></rdf:li></rdf:Seq></bib:authors>
  <dc:date>2018-03-04</dc:date>
  <dc:subject>tag one</dc:subject>
  <dc:identifier><dcterms:URI><rdf:value>https://doi.org/10.9999/abc</rdf:value></dcterms:URI></dc:identifier>
  <dcterms:isPartOf><bib:Journal><dc:title>Venue J</dc:title><prism:volume>4</prism:volume></bib:Journal></dcterms:isPartOf>
  <link:link rdf:resource="#item_2"/>
  <dcterms:isReferencedBy rdf:resource="#item_3"/>
 </bib:Article>
 <z:Attachment rdf:about="#item_2"><rdf:resource rdf:resource="files/2/paper.pdf"/></z:Attachment>
 <bib:Memo rdf:about="#item_3"><rdf:value>&lt;p&gt;First&lt;/p&gt;&lt;p&gt;Second&lt;/p&gt;</rdf:value></bib:Memo>
 <z:Collection rdf:about="#collection_1"><dc:title>Reading list</dc:title><dcterms:hasPart rdf:resource="#item_1"/></z:Collection>
</rdf:RDF>`;
  it('reads items, attachments, notes and collections', () => {
    const r = readRdf(xml, '/b');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ title: 'Synthetic & RDF', authors: ['Roe, Rick'], year: 2018, doi: '10.9999/abc', venue: 'Venue J', tags: ['tag one'], files: ['files/2/paper.pdf'], collections: ['Reading list'] });
    expect(r.entries[0]!.notes[0]).toBe('First\nSecond');
  });
  it('does not expand entities and survives broken input', () => {
    expect(readRdf('<rdf:RDF><!DOCTYPE x [<!ENTITY a "boom">]></rdf:RDF>', '/b').entries).toEqual([]);
    expect(readRdf('<<<', '/b').skipped[0]!.reason).toBe('invalid');
  });
});

describe('Zotero database reader', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'rl-zotero-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  function build(file: string) {
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE itemTypes(itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
      CREATE TABLE items(itemID INTEGER PRIMARY KEY, itemTypeID INT, key TEXT, libraryID INT);
      CREATE TABLE fields(fieldID INTEGER PRIMARY KEY, fieldName TEXT);
      CREATE TABLE itemDataValues(valueID INTEGER PRIMARY KEY, value TEXT);
      CREATE TABLE itemData(itemID INT, fieldID INT, valueID INT);
      CREATE TABLE creators(creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT);
      CREATE TABLE creatorTypes(creatorTypeID INTEGER PRIMARY KEY, creatorType TEXT);
      CREATE TABLE itemCreators(itemID INT, creatorID INT, creatorTypeID INT, orderIndex INT);
      CREATE TABLE tags(tagID INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE itemTags(itemID INT, tagID INT);
      CREATE TABLE collections(collectionID INTEGER PRIMARY KEY, collectionName TEXT);
      CREATE TABLE collectionItems(collectionID INT, itemID INT);
      CREATE TABLE itemNotes(itemID INT, parentItemID INT, note TEXT);
      CREATE TABLE itemAttachments(itemID INT, parentItemID INT, linkMode INT, contentType TEXT, path TEXT);
      CREATE TABLE deletedItems(itemID INT);
      INSERT INTO itemTypes VALUES (1,'journalArticle'),(2,'attachment'),(3,'note');
      INSERT INTO fields VALUES (1,'title'),(2,'date'),(3,'DOI'),(4,'publicationTitle'),(5,'extra');
      INSERT INTO creatorTypes VALUES (1,'author'),(2,'editor');
      INSERT INTO items VALUES (10,1,'AAAA1111',1),(11,2,'BBBB2222',1),(12,3,'CCCC3333',1),(13,1,'DDDD4444',1);
      INSERT INTO itemDataValues VALUES (1,'Synthetic Zotero Paper'),(2,'2017-06-01 2017'),(3,'10.7777/zz'),(4,'Venue Z'),(5,'Citation Key: roe2017syn'),(6,'Deleted one');
      INSERT INTO itemData VALUES (10,1,1),(10,2,2),(10,3,3),(10,4,4),(10,5,5),(13,1,6);
      INSERT INTO creators VALUES (1,'Rick','Roe',0),(2,NULL,'Lab Group',1);
      INSERT INTO itemCreators VALUES (10,1,1,0),(10,2,1,1);
      INSERT INTO tags VALUES (1,'zotero tag');
      INSERT INTO itemTags VALUES (10,1);
      INSERT INTO collections VALUES (1,'Folder A');
      INSERT INTO collectionItems VALUES (1,10);
      INSERT INTO itemNotes VALUES (12,10,'<p>Hello <b>note</b></p>');
      INSERT INTO itemAttachments VALUES (11,10,0,'application/pdf','storage:paper.pdf');
      INSERT INTO deletedItems VALUES (13);
    `);
    db.close();
  }

  it('reads items, skips deleted ones, resolves storage paths, and leaves the database untouched', async () => {
    const file = path.join(dir, 'zotero.sqlite');
    build(file);
    const before = createHash('sha256').update(await readFile(file)).digest('hex');
    const r = await readZotero(file, dir);
    expect(r.source).toBe('zotero');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ title: 'Synthetic Zotero Paper', authors: ['Roe, Rick', 'Lab Group'], year: 2017, doi: '10.7777/zz', venue: 'Venue Z', key: 'roe2017syn', tags: ['zotero tag'], collections: ['Folder A'], notes: ['Hello note'] });
    expect(r.entries[0]!.files).toEqual([path.join(dir, 'storage', 'BBBB2222', 'paper.pdf')]);
    expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(before);
  });
});

describe('matching to the library', () => {
  const lib = [
    doc({ id: '1111111111111111', path: 'a/one.pdf', hash: '1'.repeat(64), title: 'Alpha and the omega paper', authors: ['Roe, Rick'], year: 2020 }),
    doc({ id: '2222222222222222', path: 'b/two.pdf', hash: '2'.repeat(64), doi: '10.1/two', previousHashes: ['3'.repeat(64)] }),
    doc({ id: '4444444444444444', path: 'c/four.pdf', hash: '4'.repeat(64), arxivId: '2101.01234v2' }),
  ];
  const index = buildIndex(lib);
  const entry = (over: Record<string, unknown>) => ({ key: null, title: null, authors: [], year: null, venue: null, venueRef: null, doi: null, arxivId: null, tags: [], collections: [], notes: [], files: [], ...over }) as never;
  const env = (hashes: Record<string, string> = {}) => ({ base: path.resolve('/zbase'), root: path.resolve('/libroot'), index, hashFile: async (abs: string) => hashes[abs] ?? null });

  it('matches by path inside the library, by hash, by DOI, by arXiv id and by title', async () => {
    expect(await resolveEntry(entry({ files: [path.resolve('/libroot/a/one.pdf')] }), env())).toEqual({ kind: 'library', docId: '1111111111111111' });
    const outside = path.resolve('/zbase/files/x.pdf');
    expect(await resolveEntry(entry({ files: ['files/x.pdf'] }), env({ [outside]: '3'.repeat(64) }))).toEqual({ kind: 'library', docId: '2222222222222222' });
    expect(await resolveEntry(entry({ doi: '10.1/two' }), env())).toEqual({ kind: 'library', docId: '2222222222222222' });
    expect(await resolveEntry(entry({ arxivId: '2101.01234' }), env())).toEqual({ kind: 'library', docId: '4444444444444444' });
    expect(await resolveEntry(entry({ title: 'Alpha and the Omega paper!', year: 2020, authors: ['Roe, R.'] }), env())).toEqual({ kind: 'library', docId: '1111111111111111' });
  });
  it('reports external files and missing files', async () => {
    const outside = path.resolve('/zbase/new.pdf');
    expect(await resolveEntry(entry({ files: ['new.pdf'], title: 'Something unrelated' }), env({ [outside]: '9'.repeat(64) }))).toEqual({ kind: 'external', files: [outside] });
    expect(await resolveEntry(entry({ files: ['gone.pdf', 'https://example.test/x.pdf', 'notes.txt'] }), env())).toEqual({ kind: 'nofile' });
  });
  it('does not match a title shared by two documents', () => {
    const two = buildIndex([doc({ id: '1111111111111111', title: 'The very same long title', year: 2020, authors: ['A, B'] }), doc({ id: '2222222222222222', title: 'The very same long title', year: 2020, authors: ['A, C'] })]);
    expect(two.byTitle.get('theverysamelongtitle|2020|a')).toBe('');
  });
});

describe('merging fields and keys', () => {
  it('fills only empty fields or values the app extracted itself', () => {
    const d = doc({ title: 'From the file', authors: ['X Y'], year: 2000, extracted: { title: 'From the file' } });
    const e = { key: 'k', title: 'Curated title', authors: ['Roe, Rick'], year: 2021, venue: 'V', venueRef: 'vol. 1', doi: '10.1/a', arxivId: null, tags: [], collections: [], notes: [], files: [] };
    const m = mergeFields(d, e);
    expect(m.title).toBe('Curated title');
    expect(m.authors).toEqual(['X Y']);
    expect(m.year).toBe(2000);
    expect(m.ref).toMatchObject({ venue: 'V', venueRef: 'vol. 1' });
    expect(m.doi).toBe('10.1/a');
    expect(d.ref.venue).toBeUndefined();
  });
  it('makes keys unique with letters and never reuses one', () => {
    expect(freeKey('roe2020graphs', new Set())).toBe('roe2020graphs');
    expect(freeKey('roe2020graphs', new Set(['roe2020graphs']))).toBe('roe2020graphsa');
    expect(freeKey('k', new Set(['k', ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `k${c}`)]))).toBe('kaa');
  });
  it('normalises identifiers', () => {
    expect(normDoi('see https://doi.org/10.1234/ABC.5).')).toBe('10.1234/abc.5');
    expect(normArxiv('arXiv:2101.01234v3')).toBe('2101.01234');
  });
});

describe('writes only under the folder it is given', () => {
  it('has no network access in the readers (pure text in, entries out)', async () => {
    const f = path.join(os.tmpdir(), `rl-bib-${process.pid}.bib`);
    await writeFile(f, '@misc{a, title={T}}');
    expect(readBibtex(await readFile(f, 'utf8'), path.dirname(f)).entries).toHaveLength(1);
    await rm(f);
  });
});
