import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { SEARCH_MARK_OPEN } from '@rl/core';
import type {
  DocumentListQuery,
  DocumentSummary,
  FacetBucket,
  IndexableDocument,
  SearchFacets,
  SearchFilters,
  SearchIndex,
  SearchPageHit,
  SearchQuery,
  SearchResultHit,
  SearchResultPage,
  SearchSort,
} from '@rl/core';
import { normalizeText, parseQuery, stripControl, type TextFilters } from './query.js';
import { DOC_FTS_WEIGHTS, DROP_SQL, INDEX_SCHEMA_VERSION, MAX_PAGE_NUMBER, PAGE_ROWID_BASE, SCHEMA_SQL } from './schema.js';

// Match markers are control characters (SEARCH_MARK_*), stripped from every indexed text: document content can
// never forge a highlight. SQL literals for `snippet()`.
const OPEN = 'char(1)';
const CLOSE = 'char(2)';
const ELLIPSIS = "'…'";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const MAX_PAGES_PER_HIT = 8;
/** Weight of the best page score relative to the metadata score when a document matches in both. */
const PAGE_SCORE_WEIGHT = 0.5;
const FACET_LIMITS = { tags: 60, authors: 40, types: 30, venues: 30, folders: 40 } as const;

type Param = SQLInputValue;
type Row = Record<string, unknown>;

interface DocRow {
  id: number;
  doc_id: string;
  title: string | null;
  authors: string;
  year: number | null;
  type: string | null;
  venue: string | null;
  path: string;
  study: string;
  tags: string;
  direct_tags: string;
  added_at: string;
  missing: number;
  size: number;
}

interface Where {
  sql: string;
  params: Param[];
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const studyOf = (s: string): 'to-read' | 'reading' | 'read' => (s === 'reading' || s === 'read' ? s : 'to-read');

/** Structured filters (from the caller and from `author:`-style words in the text) as one SQL condition on `docs d`. */
function buildWhere(f: SearchFilters | undefined, t: TextFilters | undefined): Where {
  // Documents whose file is gone are left out unless asked for (counts, lists and filters agree).
  const cond: string[] = f?.includeMissing ? [] : ['d.missing = 0'];
  const params: Param[] = [];
  const exists = (table: 'doc_author' | 'doc_tag', inner: string, ...p: Param[]) => {
    cond.push(`EXISTS (SELECT 1 FROM ${table} x WHERE x.doc = d.id AND ${inner})`);
    params.push(...p);
  };
  // A tag filter matches the document's tags (implications already expanded) and ancestors of them (`up` rows).
  for (const tag of f?.tags ?? []) exists('doc_tag', 'x.tag = ?', tag.toLowerCase());
  const any = (f?.tagsAny ?? []).map((x) => x.toLowerCase());
  if (any.length) exists('doc_tag', `x.tag IN (${any.map(() => '?').join(',')})`, ...any);
  const none = (f?.tagsExclude ?? []).map((x) => x.toLowerCase());
  if (none.length) {
    cond.push(`NOT EXISTS (SELECT 1 FROM doc_tag x WHERE x.doc = d.id AND x.tag IN (${none.map(() => '?').join(',')}))`);
    params.push(...none);
  }
  for (const name of f?.authors ?? []) exists('doc_author', 'x.norm = ?', normalizeText(name));
  for (const term of t?.tags ?? []) exists('doc_tag', "(x.tag = ? OR x.terms LIKE ? ESCAPE '\\')", term, `%${likeEscape(term)}%`);
  for (const term of t?.authors ?? []) exists('doc_author', "x.norm LIKE ? ESCAPE '\\'", `%${likeEscape(term)}%`);

  const types = [...(f?.types ?? []), ...(t?.types ?? [])].map(normalizeText).filter(Boolean);
  if (types.length) {
    const ph = types.map(() => '?').join(',');
    cond.push(`(d.type_norm IN (${ph}) OR d.type_label_norm IN (${ph}))`);
    params.push(...types, ...types);
  }
  const venues = (f?.venues ?? []).map(normalizeText).filter(Boolean);
  if (venues.length) {
    cond.push(`d.venue_norm IN (${venues.map(() => '?').join(',')})`);
    params.push(...venues);
  }
  for (const term of t?.venues ?? []) {
    cond.push("d.venue_norm LIKE ? ESCAPE '\\'");
    params.push(`%${likeEscape(term)}%`);
  }
  if (f?.studyStates?.length) {
    cond.push(`d.study IN (${f.studyStates.map(() => '?').join(',')})`);
    params.push(...f.studyStates);
  }
  const folders = (f?.folders ?? []).map(cleanFolder).filter(Boolean);
  if (folders.length) {
    cond.push(`(${folders.map(() => 'd.folder = ? OR (d.folder >= ? AND d.folder < ?)').join(' OR ')})`);
    for (const folder of folders) params.push(folder, `${folder}/`, `${folder}0`);
  }
  if (f?.folder !== undefined) {
    const folder = cleanFolder(f.folder);
    const sub = f.includeSubfolders !== false;
    if (folder === '') {
      if (!sub) cond.push("d.folder = ''");
    } else if (sub) {
      cond.push('(d.folder = ? OR (d.folder >= ? AND d.folder < ?))');
      params.push(folder, `${folder}/`, `${folder}0`);
    } else {
      cond.push('d.folder = ?');
      params.push(folder);
    }
  }
  const from = Math.max(f?.yearFrom ?? -Infinity, t?.yearFrom ?? -Infinity);
  const to = Math.min(f?.yearTo ?? Infinity, t?.yearTo ?? Infinity);
  if (Number.isFinite(from)) {
    cond.push('d.year >= ?');
    params.push(from);
  }
  if (Number.isFinite(to)) {
    cond.push('d.year <= ?');
    params.push(to);
  }
  return { sql: cond.join(' AND '), params };
}

/** A folder path as stored in the index: no empty or `.` segments, no outer slashes. */
const cleanFolder = (p: string): string => p.split('/').filter((x) => x !== '' && x !== '.').join('/');

/** Everything below `a/b` has a folder in ["a/b/", "a/b0") ('0' is the character after '/'), so `a/bc` is outside it. */
const ORDER: Record<Exclude<SearchSort, 'relevance'>, string> = {
  title: "d.title_sort = '', d.title_sort, d.id",
  'year-desc': 'd.year IS NULL, d.year DESC, d.title_sort, d.id',
  'year-asc': 'd.year IS NULL, d.year ASC, d.title_sort, d.id',
  'added-desc': 'd.added_at DESC, d.title_sort, d.id',
  author: "d.author_sort = '', d.author_sort, d.title_sort, d.id",
  'size-desc': 'd.size DESC, d.title_sort, d.id',
  'size-asc': 'd.size ASC, d.title_sort, d.id',
};

const clampLimit = (n: number | undefined) => Math.max(1, Math.min(MAX_LIMIT, Math.floor(n ?? DEFAULT_LIMIT)));
const clampOffset = (n: number | undefined) => Math.max(0, Math.floor(n ?? 0));

function parseJsonArray(s: string): string[] {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface Matches {
  /** Matching internal ids with their score (relevance mode) or in list mode just the ids. */
  mode: 'text' | 'list' | 'none';
  where: Where;
  match: string | null;
  scored: Array<{ id: number; score: number }>;
  /** Ids that matched the metadata part (documents whose fields, not only pages, matched). */
  docLevel: Set<number>;
}

export class SqliteSearchIndex implements SearchIndex {
  private db: DatabaseSync | null = null;
  private fresh = false;
  /** Counts the writes made through this object; with `PRAGMA data_version` (other connections) it versions the cache. */
  private writes = 0;
  /**
   * The last evaluation of a query's MATCH. `searchPage` always evaluates and stores it; `facets` for the same
   * text and filters (the renderer asks for both on every keystroke) reuses it, so the full-text work is done
   * once per request pair. Never served to `searchPage`, so repeated searches are never answered from memory.
   */
  private lastMatches: { key: string; matches: Matches } | null = null;

  get needsRebuild(): boolean {
    return this.fresh;
  }

  async open(dbPath: string): Promise<void> {
    this.closeSync();
    if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
    try {
      this.db = this.init(dbPath);
    } catch (e) {
      // Unreadable or corrupt file: the index is rebuildable, so start over.
      this.closeSync();
      if (dbPath === ':memory:') throw e;
      for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(dbPath + suffix, { force: true });
      this.db = this.init(dbPath);
      this.fresh = true;
    }
  }

  private init(dbPath: string): DatabaseSync {
    const db = new DatabaseSync(dbPath);
    try {
      if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA busy_timeout = 10000; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA foreign_keys = OFF');
      const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      this.fresh = version !== INDEX_SCHEMA_VERSION;
      if (this.fresh) {
        db.exec(DROP_SQL);
        db.exec(SCHEMA_SQL);
        db.exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION}`);
      } else {
        // Touch every table so a damaged file fails here and not in the middle of a search.
        db.prepare('SELECT count(*) FROM docs').get();
        db.prepare('SELECT count(*) FROM doc_fts').get();
        db.prepare('SELECT count(*) FROM page_fts').get();
      }
      return db;
    } catch (e) {
      db.close();
      throw e;
    }
  }

  private get h(): DatabaseSync {
    if (!this.db) throw new Error('The search index is not open');
    return this.db;
  }

  private closeSync(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // already closed
      }
      this.db = null;
    }
  }

  async close(): Promise<void> {
    this.closeSync();
  }

  async reset(): Promise<void> {
    const db = this.h;
    this.writes++;
    db.exec(DROP_SQL);
    db.exec(SCHEMA_SQL);
    db.exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION}`);
    this.fresh = false;
  }

  async count(): Promise<number> {
    return (this.h.prepare('SELECT count(*) AS c FROM docs').get() as { c: number }).c;
  }

  /* ----------------------------- writes ----------------------------- */

  async upsert(doc: IndexableDocument): Promise<void> {
    await this.upsertMany([doc]);
  }

  async upsertMany(docs: IndexableDocument[]): Promise<void> {
    const db = this.h;
    this.writes++;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const doc of docs) this.upsertOne(db, doc);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  private upsertOne(db: DatabaseSync, doc: IndexableDocument): void {
    const r = doc.record;
    const existing = db.prepare('SELECT id, page_count, text_hash FROM docs WHERE doc_id = ?').get(r.id) as
      | { id: number; page_count: number; text_hash: string | null }
      | undefined;
    let id: number;
    let kept: { abstract: string; keywords: string; notes: string; annotations: string } = { abstract: '', keywords: '', notes: '', annotations: '' };
    if (existing) {
      id = existing.id;
      const old = db.prepare('SELECT abstract, keywords, notes, annotations FROM doc_fts WHERE rowid = ?').get(id) as typeof kept | undefined;
      if (old) kept = old;
      db.prepare('DELETE FROM doc_fts WHERE rowid = ?').run(id);
      db.prepare('DELETE FROM doc_author WHERE doc = ?').run(id);
      db.prepare('DELETE FROM doc_tag WHERE doc = ?').run(id);
    } else {
      const res = db.prepare('INSERT INTO docs(doc_id, path) VALUES (?, ?)').run(r.id, r.path);
      id = Number(res.lastInsertRowid);
    }

    const title = r.title ?? null;
    const venue = (r.ref.venue ?? doc.venueName ?? '').trim() || null;
    const slash = r.path.lastIndexOf('/');
    const folder = slash === -1 ? '' : r.path.slice(0, slash);
    db.prepare(
      `UPDATE docs SET title=?, title_sort=?, authors=?, author_sort=?, year=?, type=?, type_norm=?, type_label_norm=?,
       venue=?, venue_norm=?, path=?, folder=?, study=?, tags=?, direct_tags=?, added_at=?, missing=?, stamp=?, size=? WHERE id=?`,
    ).run(
      title,
      normalizeText(title ?? ''),
      JSON.stringify(r.authors),
      normalizeText(r.authors[0] ?? ''),
      r.year,
      r.type,
      normalizeText(r.type ?? ''),
      normalizeText(doc.typeLabel ?? ''),
      venue,
      normalizeText(venue ?? ''),
      r.path,
      folder,
      r.study.state,
      JSON.stringify(r.tags),
      JSON.stringify(doc.directTags ?? r.tags),
      r.addedAt,
      r.missing ? 1 : 0,
      `${r.revision}:${r.updatedAt}${doc.stampSuffix ? `|${doc.stampSuffix}` : ''}`,
      r.size,
      id,
    );

    const insAuthor = db.prepare('INSERT INTO doc_author(doc, name, norm) VALUES (?, ?, ?)');
    const seenAuthors = new Set<string>();
    for (const name of r.authors) {
      const norm = normalizeText(name).trim();
      if (!norm || seenAuthors.has(norm)) continue;
      seenAuthors.add(norm);
      insAuthor.run(id, name, norm);
    }
    const insTag = db.prepare('INSERT INTO doc_tag(doc, tag, terms, up) VALUES (?, ?, ?, ?)');
    const tagWords: string[] = [];
    for (const tag of r.tags) {
      const terms = doc.tagTerms?.[tag] ?? [tag];
      tagWords.push(...terms.map(stripControl));
      insTag.run(id, tag, `|${terms.map((x) => normalizeText(x)).join('|')}|`, 0);
    }
    const own = new Set(r.tags);
    for (const tag of doc.tagAncestors ?? []) {
      if (own.has(tag)) continue;
      const terms = doc.tagTerms?.[tag] ?? [tag];
      insTag.run(id, tag, `|${terms.map((x) => normalizeText(x)).join('|')}|`, 1);
    }

    db.prepare(
      `INSERT INTO doc_fts(rowid, title, authors, abstract, keywords, tags, venue, notes, annotations) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      stripControl(title ?? ''),
      stripControl(r.authors.join('; ')),
      stripControl(doc.abstract ?? kept.abstract),
      doc.keywords ? stripControl(doc.keywords.join('; ')) : kept.keywords,
      tagWords.join('; '),
      stripControl(venue ?? ''),
      stripControl(doc.notes ?? kept.notes),
      stripControl(doc.annotations ?? kept.annotations),
    );

    if (doc.pages) {
      db.prepare('DELETE FROM page_fts WHERE rowid BETWEEN ? AND ?').run(id * PAGE_ROWID_BASE, id * PAGE_ROWID_BASE + MAX_PAGE_NUMBER);
      const ins = db.prepare('INSERT INTO page_fts(rowid, text) VALUES (?, ?)');
      let pages = 0;
      for (const p of doc.pages) {
        if (!Number.isInteger(p.page) || p.page < 1 || p.page > MAX_PAGE_NUMBER || !p.text.trim()) continue;
        ins.run(id * PAGE_ROWID_BASE + p.page, stripControl(p.text));
        pages++;
      }
      db.prepare('UPDATE docs SET text_hash = ?, page_count = ? WHERE id = ?').run(doc.textHash ?? r.hash, pages, id);
    }
  }

  async remove(docId: string): Promise<void> {
    const db = this.h;
    const row = db.prepare('SELECT id FROM docs WHERE doc_id = ?').get(docId) as { id: number } | undefined;
    if (!row) return;
    this.writes++;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM doc_fts WHERE rowid = ?').run(row.id);
      db.prepare('DELETE FROM page_fts WHERE rowid BETWEEN ? AND ?').run(row.id * PAGE_ROWID_BASE, row.id * PAGE_ROWID_BASE + MAX_PAGE_NUMBER);
      db.prepare('DELETE FROM doc_author WHERE doc = ?').run(row.id);
      db.prepare('DELETE FROM doc_tag WHERE doc = ?').run(row.id);
      db.prepare('DELETE FROM docs WHERE id = ?').run(row.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  async indexedState(): Promise<Map<string, { textHash: string | null; stamp: string }>> {
    const rows = this.h.prepare('SELECT doc_id, text_hash, stamp FROM docs').all() as Array<{ doc_id: string; text_hash: string | null; stamp: string }>;
    return new Map(rows.map((r) => [r.doc_id, { textHash: r.text_hash, stamp: r.stamp }]));
  }

  /* ----------------------------- reads ------------------------------ */

  async search(query: SearchQuery): Promise<SearchResultHit[]> {
    return (await this.searchPage(query)).hits;
  }

  /** Identity of what `matches` depends on: text, filters and the state of the data. */
  private matchKey(query: SearchQuery): string {
    const v = (this.h.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    return JSON.stringify([query.text ?? '', query.filters ?? null, v, this.writes]);
  }

  private matches(query: SearchQuery, reuse: boolean): Matches {
    const key = this.matchKey(query);
    if (reuse && this.lastMatches?.key === key) return this.lastMatches.matches;
    const matches = this.evaluate(query);
    this.lastMatches = { key, matches };
    return matches;
  }

  private evaluate(query: SearchQuery): Matches {
    const db = this.h;
    const parsed = parseQuery(query.text ?? '');
    const where = buildWhere(query.filters, parsed.filters);
    const hasFilter = where.sql !== '';
    if (!parsed.match) {
      // Words that held nothing searchable (only operators and symbols) find nothing;
      // empty text, or text made only of filters, lists the documents.
      if (parsed.hasText) return { mode: 'none', where, match: null, scored: [], docLevel: new Set() };
      return { mode: 'list', where, match: null, scored: [], docLevel: new Set() };
    }
    const w = hasFilter ? `AND ${where.sql}` : '';
    const weights = DOC_FTS_WEIGHTS.join(', ');
    const docRows = db
      .prepare(`SELECT doc_fts.rowid AS id, -bm25(doc_fts, ${weights}) AS score FROM doc_fts JOIN docs d ON d.id = doc_fts.rowid WHERE doc_fts MATCH ? ${w}`)
      .all(parsed.match, ...where.params) as Array<{ id: number; score: number }>;
    const pageFilter = hasFilter ? `AND (rowid / ${PAGE_ROWID_BASE}) IN (SELECT d.id FROM docs d WHERE ${where.sql})` : '';
    const pageRows = db
      .prepare(
        `WITH m AS MATERIALIZED (SELECT rowid / ${PAGE_ROWID_BASE} AS d, -bm25(page_fts) AS s FROM page_fts WHERE page_fts MATCH ? ${pageFilter})
         SELECT d, max(s) AS s FROM m GROUP BY d`,
      )
      .all(parsed.match, ...where.params) as Array<{ d: number; s: number }>;
    const scores = new Map<number, number>();
    const docLevel = new Set<number>();
    for (const r of docRows) {
      scores.set(r.id, r.score);
      docLevel.add(r.id);
    }
    for (const r of pageRows) scores.set(r.d, (scores.get(r.d) ?? 0) + PAGE_SCORE_WEIGHT * r.s);
    return { mode: 'text', where, match: parsed.match, scored: [...scores].map(([id, score]) => ({ id, score })), docLevel };
  }

  async searchPage(query: SearchQuery): Promise<SearchResultPage> {
    const db = this.h;
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const m = this.matches(query, false);
    if (m.mode === 'none') return { total: 0, hits: [] };

    if (m.mode === 'list') {
      const sort = !query.sort || query.sort === 'relevance' ? 'title' : query.sort;
      const cond = m.where.sql ? `WHERE ${m.where.sql}` : '';
      const total = (db.prepare(`SELECT count(*) AS c FROM docs d ${cond}`).get(...m.where.params) as { c: number }).c;
      const rows = db
        .prepare(`SELECT d.* FROM docs d ${cond} ORDER BY ${ORDER[sort]} LIMIT ? OFFSET ?`)
        .all(...m.where.params, limit, offset) as unknown as DocRow[];
      return { total, hits: rows.map((r) => this.hitFromRow(r, 0, 'title', '')) };
    }

    const sort: SearchSort = query.sort ?? 'relevance';
    let pageIds: Array<{ id: number; score: number }>;
    if (sort === 'relevance') {
      pageIds = [...m.scored].sort((a, b) => b.score - a.score || a.id - b.id).slice(offset, offset + limit);
    } else {
      const scoreOf = new Map(m.scored.map((s) => [s.id, s.score]));
      const rows = db
        .prepare(`SELECT d.id FROM docs d WHERE d.id IN (SELECT value FROM json_each(?)) ORDER BY ${ORDER[sort]} LIMIT ? OFFSET ?`)
        .all(JSON.stringify(m.scored.map((s) => s.id)), limit, offset) as Array<{ id: number }>;
      pageIds = rows.map((r) => ({ id: r.id, score: scoreOf.get(r.id) ?? 0 }));
    }
    if (pageIds.length === 0) return { total: m.scored.length, hits: [] };

    const idsJson = JSON.stringify(pageIds.map((p) => p.id));
    const rows = db.prepare('SELECT d.* FROM docs d WHERE d.id IN (SELECT value FROM json_each(?))').all(idsJson) as unknown as DocRow[];
    const rowById = new Map(rows.map((r) => [r.id, r]));

    // Which fields matched, with snippets (only for the documents of this page).
    const snippets = new Map<number, Row>();
    if (m.docLevel.size > 0) {
      const sn = (col: number, tokens = 24) => `snippet(doc_fts, ${col}, ${OPEN}, ${CLOSE}, ${ELLIPSIS}, ${tokens})`;
      const sql = `SELECT rowid AS id, ${sn(0, 32)} AS title, ${sn(1)} AS authors, ${sn(2)} AS abstract, ${sn(3)} AS keywords,
        ${sn(4)} AS tags, ${sn(5)} AS venue, ${sn(6)} AS notes, ${sn(7)} AS annotations
        FROM doc_fts WHERE doc_fts MATCH ? AND rowid IN (SELECT value FROM json_each(?))`;
      for (const r of db.prepare(sql).all(m.match, idsJson) as Row[]) snippets.set(Number(r.id), r);
    }
    // Pages of the full text that match, for the documents of this page: scored in one pass, then the best
    // few per document get a snippet.
    const pagesByDoc = new Map<number, SearchPageHit[]>();
    if (m.match) {
      const scored = db
        .prepare(
          `SELECT rowid AS rid, -bm25(page_fts) AS s FROM page_fts
           WHERE page_fts MATCH ? AND (rowid / ${PAGE_ROWID_BASE}) IN (SELECT value FROM json_each(?))`,
        )
        .all(m.match, idsJson) as Array<{ rid: number; s: number }>;
      const perDoc = new Map<number, Array<{ rid: number; s: number }>>();
      for (const r of scored) {
        const d = Math.floor(r.rid / PAGE_ROWID_BASE);
        const list = perDoc.get(d) ?? [];
        list.push(r);
        perDoc.set(d, list);
      }
      const chosen: number[] = [];
      for (const list of perDoc.values()) {
        list.sort((a, b) => b.s - a.s || a.rid - b.rid);
        for (const r of list.slice(0, MAX_PAGES_PER_HIT)) chosen.push(r.rid);
      }
      if (chosen.length > 0) {
        const snippetRows = db
          .prepare(
            `SELECT rowid AS rid, snippet(page_fts, 0, ${OPEN}, ${CLOSE}, ${ELLIPSIS}, 24) AS snippet FROM page_fts
             WHERE page_fts MATCH ? AND rowid IN (SELECT value FROM json_each(?))`,
          )
          .all(m.match, JSON.stringify(chosen)) as Array<{ rid: number; snippet: string }>;
        const snippetOf = new Map(snippetRows.map((r) => [r.rid, r.snippet]));
        for (const [d, list] of perDoc) {
          pagesByDoc.set(
            d,
            list.slice(0, MAX_PAGES_PER_HIT).map((r) => ({ page: r.rid % PAGE_ROWID_BASE, snippet: snippetOf.get(r.rid) ?? '' })),
          );
        }
      }
    }

    const hits: SearchResultHit[] = [];
    for (const { id, score } of pageIds) {
      const row = rowById.get(id);
      if (!row) continue;
      const pages = pagesByDoc.get(id) ?? [];
      const sn = snippets.get(id);
      const marked = (col: string): string | null => {
        const v = sn?.[col];
        return typeof v === 'string' && v.includes(SEARCH_MARK_OPEN) ? v : null;
      };
      let field: SearchResultHit['field'] = 'text';
      let snippet = '';
      const title = marked('title');
      const summary = marked('abstract') ?? marked('keywords') ?? marked('authors') ?? marked('tags') ?? marked('venue');
      const note = marked('notes');
      const annotation = marked('annotations');
      if (title) [field, snippet] = ['title', title];
      else if (summary) [field, snippet] = ['summary', summary];
      else if (note) [field, snippet] = ['note', note];
      else if (annotation) [field, snippet] = ['annotation', annotation];
      else if (pages[0]) snippet = pages[0].snippet;
      const hit = this.hitFromRow(row, score, field, snippet);
      if (pages.length > 0) {
        hit.page = pages[0]!.page;
        hit.pages = [...pages].sort((a, b) => a.page - b.page);
      }
      hits.push(hit);
    }
    return { total: m.scored.length, hits };
  }

  private hitFromRow(r: DocRow, score: number, field: SearchResultHit['field'], snippet: string): SearchResultHit {
    return {
      docId: r.doc_id,
      score,
      field,
      snippet,
      title: r.title,
      authors: parseJsonArray(r.authors),
      year: r.year,
      type: r.type,
      path: r.path,
      studyState: studyOf(r.study),
      size: r.size,
      tags: parseJsonArray(r.tags),
      directTags: parseJsonArray(r.direct_tags),
    };
  }

  async facets(query: SearchQuery): Promise<SearchFacets> {
    const db = this.h;
    const m = this.matches(query, true);
    if (m.mode === 'none') return emptyFacets();
    // Matching documents as a sub-select: in list mode straight from the filter, else from the scored ids.
    let from: string;
    let params: Param[];
    if (m.mode === 'list') {
      from = `SELECT d.id FROM docs d ${m.where.sql ? `WHERE ${m.where.sql}` : ''}`;
      params = m.where.params;
    } else {
      from = 'SELECT value AS id FROM json_each(?)';
      params = [JSON.stringify(m.scored.map((s) => s.id))];
    }
    const buckets = (sql: string): FacetBucket[] =>
      (db.prepare(sql).all(...params) as Array<{ value: string; count: number }>).map((r) => ({ value: String(r.value), count: r.count }));
    const total = (db.prepare(`SELECT count(*) AS c FROM (${from})`).get(...params) as { c: number }).c;
    return {
      total,
      tags: buckets(
        `SELECT t.tag AS value, count(*) AS count FROM doc_tag t WHERE t.up = 0 AND t.doc IN (${from}) GROUP BY t.tag ORDER BY count DESC, value LIMIT ${FACET_LIMITS.tags}`,
      ),
      authors: buckets(
        `SELECT min(a.name) AS value, count(*) AS count FROM doc_author a WHERE a.doc IN (${from}) GROUP BY a.norm ORDER BY count DESC, value LIMIT ${FACET_LIMITS.authors}`,
      ),
      types: buckets(
        `SELECT d.type AS value, count(*) AS count FROM docs d WHERE d.id IN (${from}) AND d.type IS NOT NULL AND d.type <> '' GROUP BY d.type ORDER BY count DESC, value LIMIT ${FACET_LIMITS.types}`,
      ),
      venues: buckets(
        `SELECT min(d.venue) AS value, count(*) AS count FROM docs d WHERE d.id IN (${from}) AND d.venue_norm <> '' GROUP BY d.venue_norm ORDER BY count DESC, value LIMIT ${FACET_LIMITS.venues}`,
      ),
      studyStates: buckets(`SELECT d.study AS value, count(*) AS count FROM docs d WHERE d.id IN (${from}) GROUP BY d.study ORDER BY count DESC, value`),
      years: buckets(`SELECT d.year AS value, count(*) AS count FROM docs d WHERE d.id IN (${from}) AND d.year IS NOT NULL GROUP BY d.year ORDER BY d.year DESC`),
      folders: buckets(
        `SELECT substr(d.folder, 1, instr(d.folder || '/', '/') - 1) AS value, count(*) AS count FROM docs d
         WHERE d.id IN (${from}) AND d.folder <> '' GROUP BY value ORDER BY count DESC, value LIMIT ${FACET_LIMITS.folders}`,
      ),
    };
  }

  async list(query: DocumentListQuery): Promise<{ total: number; items: DocumentSummary[] }> {
    const db = this.h;
    const where = buildWhere(query.filters, undefined);
    const cond = where.sql ? `WHERE ${where.sql}` : '';
    const total = (db.prepare(`SELECT count(*) AS c FROM docs d ${cond}`).get(...where.params) as { c: number }).c;
    const rows = db
      .prepare(`SELECT d.* FROM docs d ${cond} ORDER BY ${ORDER[query.sort ?? 'title']} LIMIT ? OFFSET ?`)
      .all(...where.params, clampLimit(query.limit), clampOffset(query.offset)) as unknown as DocRow[];
    return {
      total,
      items: rows.map((r) => ({
        docId: r.doc_id,
        title: r.title,
        authors: parseJsonArray(r.authors),
        year: r.year,
        type: r.type,
        venue: r.venue,
        path: r.path,
        studyState: studyOf(r.study),
        tags: parseJsonArray(r.tags),
        directTags: parseJsonArray(r.direct_tags),
        addedAt: r.added_at,
        missing: r.missing === 1,
        size: r.size,
      })),
    };
  }
}

function emptyFacets(): SearchFacets {
  return { total: 0, tags: [], authors: [], types: [], venues: [], studyStates: [], years: [], folders: [] };
}
