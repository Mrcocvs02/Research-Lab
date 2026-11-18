import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { editAuthorAliases, readAuthorAliases } from './author-aliases.js';

let dir: string;
let rt: any;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rl-aliases-'));
  rt = { store: { dataDir: dir } };
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const file = () => path.join(dir, 'graph', 'author-aliases.json');

describe('author corrections store', () => {
  it('starts empty and writes atomically into the data folder', async () => {
    expect((await readAuthorAliases(rt)).aliases).toEqual({ merge: {}, split: [] });
    await editAuthorAliases(rt, { action: 'split', key: 'rossi a' });
    expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual({ merge: {}, split: ['rossi a'] });
  });

  it('merges without chains or loops and a split undoes the merge', async () => {
    await editAuthorAliases(rt, { action: 'merge', from: 'a', to: 'b' });
    await editAuthorAliases(rt, { action: 'merge', from: 'b', to: 'c' });
    expect({ ...(await readAuthorAliases(rt)).aliases.merge }).toEqual({ a: 'c', b: 'c' });
    await editAuthorAliases(rt, { action: 'merge', from: 'c', to: 'a' });
    const m = { ...(await readAuthorAliases(rt)).aliases.merge };
    expect(Object.keys(m).every((k) => m[k] !== k && !(m[m[k]!] !== undefined))).toBe(true);
    await editAuthorAliases(rt, { action: 'split', key: 'a' });
    expect({ ...(await readAuthorAliases(rt)).aliases.merge }).not.toHaveProperty('c');
    expect((await readAuthorAliases(rt)).aliases.split).toContain('a');
  });

  it('imports older corrections once without overriding existing ones', async () => {
    await editAuthorAliases(rt, { action: 'merge', from: 'x', to: 'y' });
    const r = await editAuthorAliases(rt, { action: 'import', aliases: { merge: { x: 'z', p: 'q' }, split: ['s'] } });
    expect({ ...r.merge }).toEqual({ x: 'y', p: 'q' });
    expect(r.split).toEqual(['s']);
  });

  it('runs concurrent edits one after the other and ignores a damaged file', async () => {
    await Promise.all(['a', 'b', 'c', 'd'].map((key) => editAuthorAliases(rt, { action: 'split', key })));
    expect([...(await readAuthorAliases(rt)).aliases.split].sort()).toEqual(['a', 'b', 'c', 'd']);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file(), '{"merge": [1');
    expect((await readAuthorAliases(rt)).aliases).toEqual({ merge: {}, split: [] });
  });

  it('treats prototype-looking keys as plain keys', async () => {
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file(), '{"merge":{"__proto__":"x","constructor":"y"},"split":[]}');
    const { aliases } = await readAuthorAliases(rt);
    expect(Object.hasOwn(aliases.merge, 'constructor')).toBe(true);
    expect(({} as any).x).toBeUndefined();
  });
});
