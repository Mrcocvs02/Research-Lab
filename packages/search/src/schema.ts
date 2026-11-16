/**
 * Layout of the search index file. The file is local and rebuildable (never synced): when
 * `INDEX_SCHEMA_VERSION` differs from the one stored in the file, everything is dropped and refilled.
 */
export const INDEX_SCHEMA_VERSION = 2;

/** Page rows of `page_fts` have rowid = docs.id * PAGE_ROWID_BASE + page, so a document's pages are one rowid range. */
export const PAGE_ROWID_BASE = 1_000_000;
export const MAX_PAGE_NUMBER = PAGE_ROWID_BASE - 1;

const TOKENIZER = "tokenize='unicode61 remove_diacritics 2'";
/** Prefix indexes: short prefixes for the small metadata table, 3 letters for the big page table (longer prefixes scan terms). */
const DOC_PREFIX = "prefix='2 3 4'";
const PAGE_PREFIX = "prefix='3'";

/** Column order of `doc_fts`; the BM25 weights below follow it. */
export const DOC_FTS_COLUMNS = ['title', 'authors', 'abstract', 'keywords', 'tags', 'venue', 'notes', 'annotations'] as const;
/** title > authors/keywords/tags > abstract > venue > notes > annotations (the page text weighs 1 by default). */
export const DOC_FTS_WEIGHTS = [10, 5, 3, 5, 4, 2, 2, 1.5] as const;

export const SCHEMA_SQL = `
CREATE TABLE docs (
  id INTEGER PRIMARY KEY,
  doc_id TEXT NOT NULL UNIQUE,
  title TEXT,
  title_sort TEXT NOT NULL DEFAULT '',
  authors TEXT NOT NULL DEFAULT '[]',
  author_sort TEXT NOT NULL DEFAULT '',
  year INTEGER,
  type TEXT,
  type_norm TEXT NOT NULL DEFAULT '',
  type_label_norm TEXT NOT NULL DEFAULT '',
  venue TEXT,
  venue_norm TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  study TEXT NOT NULL DEFAULT 'to-read',
  tags TEXT NOT NULL DEFAULT '[]',
  added_at TEXT NOT NULL DEFAULT '',
  missing INTEGER NOT NULL DEFAULT 0,
  text_hash TEXT,
  stamp TEXT NOT NULL DEFAULT '',
  page_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX docs_year ON docs(year);
CREATE INDEX docs_folder ON docs(folder);
CREATE TABLE doc_author (doc INTEGER NOT NULL, name TEXT NOT NULL, norm TEXT NOT NULL);
CREATE INDEX doc_author_doc ON doc_author(doc);
CREATE INDEX doc_author_norm ON doc_author(norm);
CREATE TABLE doc_tag (doc INTEGER NOT NULL, tag TEXT NOT NULL, terms TEXT NOT NULL);
CREATE INDEX doc_tag_doc ON doc_tag(doc);
CREATE INDEX doc_tag_tag ON doc_tag(tag);
CREATE VIRTUAL TABLE doc_fts USING fts5(${DOC_FTS_COLUMNS.join(', ')}, ${TOKENIZER}, ${DOC_PREFIX});
CREATE VIRTUAL TABLE page_fts USING fts5(text, ${TOKENIZER}, ${PAGE_PREFIX});
`;

export const DROP_SQL = `
DROP TABLE IF EXISTS doc_fts;
DROP TABLE IF EXISTS page_fts;
DROP TABLE IF EXISTS doc_author;
DROP TABLE IF EXISTS doc_tag;
DROP TABLE IF EXISTS docs;
`;
