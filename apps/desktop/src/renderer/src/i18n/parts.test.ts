/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { coreOf, flatten, partNames, partOf } from './testing';

const root = path.resolve(import.meta.dirname, '..');
const plural = (k: string) => k.replace(/_(one|other|zero|two|few|many)$/, '');

/** Where each key lives (the same in both languages, checked below): 'core' or the name of a part. */
const placement = new Map<string, string>();
for (const k of flatten(coreOf('en'))) placement.set(k, 'core');
for (const p of partNames('en')) for (const k of flatten(partOf('en', p))) placement.set(k, p);
const keys = [...placement.keys()];

describe('strings split into core and parts', () => {
  it('has the same parts, with the same keys, in Italian and English', () => {
    expect(partNames('it')).toEqual(partNames('en'));
    expect(flatten(coreOf('it')).sort()).toEqual(flatten(coreOf('en')).sort());
    for (const p of partNames('en')) expect(flatten(partOf('it', p)).sort(), p).toEqual(flatten(partOf('en', p)).sort());
  });

  it('puts every key in exactly one place', () => {
    const all = [...flatten(coreOf('en')), ...partNames('en').flatMap((p) => flatten(partOf('en', p)))];
    expect(all.length).toBe(new Set(all).size);
  });

  it('keeps the list of part names of the loader in step with the files', () => {
    const src = readFileSync(path.join(root, 'i18n', 'index.ts'), 'utf8');
    const union = /export type StringPart =([^;]*);/.exec(src)![1]!;
    expect([...union.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort()).toEqual(partNames('en'));
  });
});

// ---- Every key a file uses is in the core or in the parts loaded by each lazy view that includes the file ----

const sources: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'testing') walk(full);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'env.d.ts') sources.push(full);
  }
};
walk(root);
const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');

/** The keys a source file may use: literal keys, plural bases, and `prefix.${x}` / `prefix_${x}` families. */
function usedKeys(src: string): Set<string> {
  const out = new Set<string>();
  const add = (s: string, prefix: boolean) => {
    for (const k of keys) {
      const base = plural(k);
      if (base === s || base.startsWith(`${s}.`) || (prefix && k.startsWith(s))) out.add(k);
    }
  };
  for (const m of src.matchAll(/(['"`])([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)*\.?)(\$\{|\1)/g)) {
    const s = m[2]!;
    if (m[3] === '${') {
      if (s.includes('.')) add(s.replace(/\.$/, ''), true);
    } else if (keys.some((k) => plural(k) === s)) add(s, false);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  return [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find((c) => existsSync(c)) ?? null;
}

const text = new Map(sources.map((f) => [f, readFileSync(f, 'utf8')]));
const staticImports = new Map<string, string[]>();
for (const [f, src] of text) {
  const specs = [...src.matchAll(/(?:import|export)\s[^'"`;]*?from\s*'(\.[^']*)'/g), ...src.matchAll(/import\s*'(\.[^']*)'/g)].map((m) => m[1]!);
  staticImports.set(f, specs.map((s) => resolveImport(f, s)).filter((x): x is string => x !== null));
}
function closure(start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (seen.has(f) || !text.has(f)) continue;
    seen.add(f);
    queue.push(...(staticImports.get(f) ?? []));
  }
  return seen;
}

const LIST_AT_END = /,\s*\[([^\]]*)\]\s*\)\s*$/;

/** The lazy views: file -> parts loaded with it (what `lazyView(() => import('...'), [parts])` declares; the common set when several loaders share a file). */
function lazyEntries(): Map<string, string[]> {
  const entries = new Map<string, string[][]>();
  for (const [f, src] of text) {
    for (const stmt of src.split(/;\s*\n/)) {
      const m = /\blazy(View|Retry)\(\s*\(\)\s*=>\s*import\('(\.[^']*)'\)/.exec(stmt);
      if (!m) continue;
      const target = resolveImport(f, m[2]!);
      if (!target) throw new Error(`${rel(f)}: unresolved lazy import ${m[2]}`);
      let declared: string[] = [];
      if (m[1] === 'View') {
        const list = LIST_AT_END.exec(stmt);
        if (!list) throw new Error(`${rel(f)}: lazyView without a literal list of parts`);
        declared = [...list[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
      }
      entries.set(target, [...(entries.get(target) ?? []), declared]);
    }
  }
  return new Map([...entries].map(([t, lists]) => [t, lists.reduce((a, b) => a.filter((p) => b.includes(p)))]));
}

describe('strings of every file are loaded with its view', () => {
  const entries = lazyEntries();

  it('finds the lazy views and only declares parts that exist', () => {
    expect(entries.size).toBeGreaterThan(10);
    const names = new Set(partNames('en'));
    for (const [e, parts] of entries) for (const p of parts) expect(names.has(p), `${rel(e)}: ${p}`).toBe(true);
  });

  it('has no component import() outside lazyView/lazyRetry (other than the known prefetch, pdf.js and thumbnails)', () => {
    const allowed = ['i18n/index.ts', 'lib/pdfjs.ts', 'lib/thumbs.ts', 'views/reader/engine.ts', 'views/library/LibraryView.tsx'];
    const stray: string[] = [];
    for (const [f, src] of text) {
      if (allowed.includes(rel(f))) continue;
      for (const stmt of src.split(/;\s*\n/)) if (/\bimport\('\.[^']*'\)/.test(stmt) && !/\blazy(View|Retry)\(/.test(stmt)) stray.push(`${rel(f)}: ${stmt.trim().slice(0, 80)}`);
    }
    expect(stray).toEqual([]);
  });

  it('has every key a file uses in the core, or in the parts loaded by each lazy view that includes the file', () => {
    const main = closure(path.join(root, 'main.tsx'));
    const closures = [...entries].map(([entry, parts]) => ({ entry, parts: new Set(parts), files: closure(entry) }));
    const problems: string[] = [];
    for (const [f, src] of text) {
      if (rel(f) === 'i18n/index.ts') continue;
      const used = usedKeys(src);
      if (used.size === 0) continue;
      // A file of the first screen (or of no view at all) can only count on the core.
      const holders = main.has(f) ? [] : closures.filter((c) => c.files.has(f));
      for (const k of used) {
        const where = placement.get(k)!;
        if (where === 'core') continue;
        if (holders.length === 0) problems.push(`${rel(f)}: ${k} is in part "${where}" but the file is part of the first screen`);
        else for (const h of holders) if (!h.parts.has(where)) problems.push(`${rel(f)}: ${k} is in part "${where}", not loaded by ${rel(h.entry)}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
