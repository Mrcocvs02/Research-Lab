import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channels } from '@rl/core';
import type { MainServices } from '../../ipc/handlers/services.js';
import { saveText } from './refs.js';

// The Map exported as PNG (D-528): the bytes arrive in base64, a new file is written next to the others, nothing is overwritten.
let lib: string;
let out: string;
let s: MainServices;
// The first bytes of any PNG file (the signature), then a few invented ones.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('invented body')]);
const schema = channels['bib:saveText'].request;

beforeEach(async () => {
  lib = await mkdtemp(path.join(os.tmpdir(), 'rl-save-lib-'));
  out = await mkdtemp(path.join(os.tmpdir(), 'rl-save-out-'));
  s = { runtime: { require: async () => ({ store: { rootPath: lib } }) }, approved: { resolve: (d: string) => d } } as unknown as MainServices;
});
afterEach(async () => {
  await rm(lib, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

describe('bib:saveText with png', () => {
  it('writes the decoded bytes as a new .png and never overwrites', async () => {
    const req = { destination: out, fileName: 'map-topic', ext: 'png' as const, text: PNG.toString('base64'), base64: true };
    expect((await saveText(s, req)).file).toBe('map-topic.png');
    expect((await saveText(s, req)).file).toBe('map-topic-2.png');
    expect(await readFile(path.join(out, 'map-topic.png'))).toEqual(PNG);
    expect((await readdir(out)).sort()).toEqual(['map-topic-2.png', 'map-topic.png']);
  });

  it('refuses what is no PNG, and a png without base64 (nothing is written)', async () => {
    await expect(saveText(s, { destination: out, fileName: 'x', ext: 'png', text: Buffer.from('not an image').toString('base64'), base64: true })).rejects.toMatchObject({ details: { reason: 'not-png' } });
    await expect(saveText(s, { destination: out, fileName: 'x', ext: 'png', text: PNG.toString('base64') })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await readdir(out)).toEqual([]);
  });

  it('keeps the limits of each kind: svg up to 2 000 000 characters, md and pdf 400 000, png 8 000 000', async () => {
    const ok = (ext: string, n: number, base64?: boolean) => schema.safeParse({ destination: 'd', fileName: 'f', ext, text: 'x'.repeat(n), ...(base64 ? { base64 } : {}) }).success;
    expect(ok('png', 8_000_000, true)).toBe(true);
    expect(ok('png', 8_000_001, true)).toBe(false);
    expect(ok('svg', 2_000_000)).toBe(true);
    expect(ok('md', 400_000)).toBe(true);
    // Beyond 400 000 characters md and pdf pass the schema (one limit for the lot) and are stopped by the handler before writing.
    await expect(saveText(s, { destination: out, fileName: 'x', ext: 'md', text: 'x'.repeat(400_001) })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(saveText(s, { destination: out, fileName: 'x', ext: 'svg', text: 'x'.repeat(2_000_001) })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await saveText(s, { destination: out, fileName: 'x', ext: 'svg', text: '<svg/>' })).toEqual({ file: 'x.svg' });
    expect(await readdir(out)).toEqual(['x.svg']);
  });
});
