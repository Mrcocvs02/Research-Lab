// Spike: node:sqlite + FTS5. Usable under Node and as an Electron main script.
function run() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE VIRTUAL TABLE t USING fts5(title, body, tokenize='unicode61 remove_diacritics 2')");
  db.prepare('INSERT INTO t(title, body) VALUES (?, ?)').run('Alpha', 'quantum entanglement of perception');
  db.prepare('INSERT INTO t(title, body) VALUES (?, ?)').run('Beta', 'università e ricerca');
  const hit = db.prepare('SELECT title FROM t WHERE t MATCH ? ORDER BY rank').all('entangle*');
  const accent = db.prepare('SELECT title FROM t WHERE t MATCH ?').all('universita');
  const version = db.prepare('select sqlite_version() as v').get().v;
  db.close();
  return { sqlite: version, node: process.versions.node, electron: process.versions.electron ?? null, hits: hit.map((r) => r.title), accentHits: accent.map((r) => r.title) };
}
try {
  const r = run();
  console.log('RESULT ' + JSON.stringify(r));
} catch (e) { console.log('RESULT ' + JSON.stringify({ error: String(e) })); }
if (process.versions.electron) require('electron').app.whenReady().then(() => require('electron').app.quit());
