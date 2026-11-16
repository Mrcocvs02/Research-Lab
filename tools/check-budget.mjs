#!/usr/bin/env node
// Checks the size of the built bundles against tools/budgets.json. Run it after `npm run build`.
//   node tools/check-budget.mjs          check and print the table
//   node tools/check-budget.mjs --json   print the measured values as JSON (used to set the budgets)
// Sizes are in KiB of the files on disk (minified, not compressed). Memory at rest and time to the first content are
// checked by e2e/qa-budget.spec.ts, against the same file.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'apps/desktop/out');
const budgets = JSON.parse(readFileSync(path.join(root, 'tools/budgets.json'), 'utf8'));

const kib = (bytes) => Math.round((bytes / 1024) * 10) / 10;

function files(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full, ext);
    return e.name.endsWith(ext) ? [full] : [];
  });
}
const sum = (list) => list.reduce((n, f) => n + statSync(f).size, 0);

/** The JS the window needs before the first screen: the scripts of index.html and, transitively, what they import statically. */
function initialRenderer() {
  const dir = path.join(out, 'renderer');
  const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
  const queue = [...html.matchAll(/(?:src|href)="\.?\/?([^"]+\.js)"/g)].map((m) => path.join(dir, m[1]));
  const seen = new Set();
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const code = readFileSync(file, 'utf8');
    // Static imports only: `import ... from "./x.js"` and `import "./x.js"`; `import("./x.js")` and the preload map are lazy.
    for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.\/[^"']+\.js)["']/g)) queue.push(path.join(path.dirname(file), m[1]));
  }
  // The dictionary of the active language is fetched right at the start: count the larger of the two.
  const dicts = (budgets.renderer?.dictionaryChunks ?? []).flatMap((p) => files(path.join(dir, 'assets'), '.js').filter((f) => path.basename(f).startsWith(`${p}-`)));
  const dictBytes = Math.max(0, ...dicts.map((f) => statSync(f).size));
  return { bytes: sum([...seen]) + dictBytes, chunks: [...seen].map((f) => path.basename(f)) };
}

const initial = initialRenderer();
const measured = {
  'renderer.initialJsKB': kib(initial.bytes),
  'renderer.totalJsKB': kib(sum(files(path.join(out, 'renderer'), '.js'))),
  'renderer.totalKB': kib(sum(files(path.join(out, 'renderer'), '.js')) + sum(files(path.join(out, 'renderer'), '.css')) + sum(files(path.join(out, 'renderer'), '.html'))),
  'main.totalJsKB': kib(sum(files(path.join(out, 'main'), '.js'))),
  'preload.totalKB': kib(sum([...files(path.join(out, 'preload'), '.cjs'), ...files(path.join(out, 'preload'), '.js')])),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(measured, null, 2));
  process.exit(0);
}
if (measured['renderer.totalJsKB'] === 0) {
  console.error('check-budget: no build found in apps/desktop/out. Run `npm run build` first.');
  process.exit(2);
}

const limitOf = (key) => key.split('.').reduce((o, k) => o?.[k], budgets);
let failed = 0;
for (const [key, value] of Object.entries(measured)) {
  const limit = limitOf(key);
  if (typeof limit !== 'number') {
    console.log(`  ${key.padEnd(24)} ${String(value).padStart(8)} KiB   (no budget)`);
    continue;
  }
  const over = value > limit;
  if (over) failed++;
  console.log(`${over ? 'X' : ' '} ${key.padEnd(24)} ${String(value).padStart(8)} KiB   budget ${limit} KiB${over ? `   OVER by ${kib((value - limit) * 1024)} KiB` : ''}`);
}
if (failed > 0) {
  console.error(
    `\ncheck-budget: ${failed} budget${failed > 1 ? 's' : ''} exceeded. The app must stay light (docs/RULES.md): find what grew ` +
      '(a new dependency, a view that is no longer loaded on demand, a module imported by the first screen) and fix it. ' +
      'Raising a budget in tools/budgets.json needs a decision in docs/DECISIONS.md.',
  );
  console.error(`The first screen loads: ${initial.chunks.join(', ')}`);
  process.exit(1);
}
console.log('\ncheck-budget: all bundle budgets met.');
