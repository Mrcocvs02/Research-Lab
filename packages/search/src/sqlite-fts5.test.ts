import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

/**
 * Driver decision D-007: the built-in `node:sqlite` is the SQLite driver.
 * This proves FTS5 under Node (Vitest). The same check under Electron's main process
 * runs in `e2e/sqlite-electron.spec.ts` using `tools/spikes/sqlite-fts5.cjs`.
 */
describe('node:sqlite with FTS5', () => {
  it('creates an FTS5 table, matches with prefix, ranks and folds diacritics', () => {
    const db = new DatabaseSync(':memory:');
    db.exec("CREATE VIRTUAL TABLE docs USING fts5(title, body, tokenize='unicode61 remove_diacritics 2')");
    const ins = db.prepare('INSERT INTO docs(title, body) VALUES (?, ?)');
    ins.run('Alpha', 'quantum entanglement of perception');
    ins.run('Beta', 'università e ricerca');
    ins.run('Gamma', 'entanglement entanglement entanglement');
    const titles = (q: string) => (db.prepare('SELECT title FROM docs WHERE docs MATCH ? ORDER BY rank').all(q) as Array<{ title: string }>).map((r) => r.title);
    expect(titles('entangle*')).toEqual(['Gamma', 'Alpha']);
    expect(titles('universita')).toEqual(['Beta']);
    expect(titles('title:Alpha')).toEqual(['Alpha']);
    const snippet = db.prepare("SELECT snippet(docs, 1, '[[', ']]', '...', 5) AS s FROM docs WHERE docs MATCH 'perception'").get() as { s: string };
    expect(snippet.s).toContain('[[perception]]');
    db.close();
  });
});
