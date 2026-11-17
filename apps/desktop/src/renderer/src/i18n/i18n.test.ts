/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@rl/core';
import { loadDictionary } from './testing';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)));
}

/** Core and parts together: the whole dictionary of a language (the split is checked in `parts.test.ts`). */
const en = loadDictionary('en');
const itDict = loadDictionary('it');
const enKeys = flatten(en as Tree).sort();
const itKeys = flatten(itDict as Tree).sort();

describe('dictionaries', () => {
  it('have exactly the same keys in Italian and English', () => {
    expect(itKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !itKeys.includes(k))).toEqual([]);
  });

  it('have no empty strings and the same interpolation placeholders', () => {
    const flat = (tree: Tree, prefix = ''): Array<[string, string]> =>
      Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : flat(v, `${prefix}${k}.`)));
    const e = new Map(flat(en as Tree));
    for (const [key, value] of flat(itDict as Tree)) {
      expect(value.trim(), key).not.toBe('');
      const names = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
      expect(names(value), key).toEqual(names(e.get(key) ?? ''));
    }
  });

  it('have a message for every error code', () => {
    for (const code of ERROR_CODES) expect(enKeys, code).toContain(`errors.${code}`);
  });

  it('define every key used literally in the renderer code', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) files.push(full);
      }
    };
    walk(root);
    const has = (key: string) => enKeys.includes(key) || enKeys.some((k) => k.startsWith(`${key}_`));
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) if (!has(m[1]!)) missing.push(`${path.basename(file)}: ${m[1]}`);
      // Dynamic keys: `t(`prefix.${x}`)` needs at least one key under the prefix.
      for (const m of src.matchAll(/\bt\(\s*`([A-Za-z0-9_.]+)\.\$\{/g)) {
        if (!enKeys.some((k) => k.startsWith(`${m[1]}.`))) missing.push(`${path.basename(file)}: ${m[1]}.*`);
      }
    }
    expect(missing).toEqual([]);
  });
});
