/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Test helpers: the dictionary files of a language, read from disk. */
export type Tree = { [k: string]: string | Tree };

const dir = path.resolve(import.meta.dirname, 'locales');
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Tree;

export const partNames = (lng: string): string[] =>
  readdirSync(path.join(dir, 'parts', lng))
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -5))
    .sort();

export const coreOf = (lng: string): Tree => read(path.join(dir, `${lng}.json`));
export const partOf = (lng: string, part: string): Tree => read(path.join(dir, 'parts', lng, `${part}.json`));

export function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)));
}

function merge(into: Tree, from: Tree): void {
  for (const [k, v] of Object.entries(from)) {
    if (typeof v === 'string') into[k] = v;
    else merge((into[k] ??= {}) as Tree, v);
  }
}

/** Core and every part of a language as one dictionary. */
export function loadDictionary(lng: string): Tree {
  const all: Tree = {};
  merge(all, coreOf(lng));
  for (const p of partNames(lng)) merge(all, partOf(lng, p));
  return all;
}
