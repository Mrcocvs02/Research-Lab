import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { dataPath, documentIdSchema, type LiteratureNote } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';

/**
 * `literature/<docId>.md` (D-405): AI-owned, apart from the user's notes. The front matter is the one the analysis pipeline
 * already writes (`ai`, `review`, `version`, `model`, `generatedAt`, `mode`) plus `abstractOnly`; a note written by that
 * pipeline reads back here as a proposal. The user's own notes are never read from or written to this file.
 */
const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const fileOf = (dataDir: string, docId: string): string => path.join(dataDir, ...dataPath.literature(documentIdSchema.parse(docId)).split('/'));

export function parseLiterature(raw: string): LiteratureNote | null {
  const m = FM.exec(raw);
  const head = new Map<string, string>();
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) head.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  const body = raw.replace(FM, '').trim();
  if (body === '') return null;
  const at = head.get('generatedAt');
  return {
    body,
    review: head.get('review') === 'approved' ? 'approved' : 'proposed',
    ai: head.get('ai') !== 'false',
    model: head.get('model') || null,
    generatedAt: at && !Number.isNaN(Date.parse(at)) ? at : null,
    abstractOnly: head.get('abstractOnly') === 'true',
  };
}

export function serializeLiterature(docId: string, n: LiteratureNote, version: string): string {
  const lines = [`docId: ${docId}`, `ai: ${n.ai}`, `review: ${n.review}`, `version: ${version}`, ...(n.model ? [`model: ${n.model}`] : []), ...(n.generatedAt ? [`generatedAt: ${n.generatedAt}`] : []), ...(n.abstractOnly ? ['abstractOnly: true'] : [])];
  return `---\n${lines.join('\n')}\n---\n${n.body.trim()}\n`;
}

export async function readLiterature(dataDir: string, docId: string): Promise<LiteratureNote | null> {
  const raw = await readFile(fileOf(dataDir, docId), 'utf8').catch(() => null);
  return raw === null ? null : parseLiterature(raw);
}

export async function writeLiterature(dataDir: string, docId: string, note: LiteratureNote, version: string): Promise<void> {
  const f = fileOf(dataDir, docId);
  await mkdir(path.dirname(f), { recursive: true });
  await atomicWriteFile(f, serializeLiterature(docId, note, version));
}

export async function removeLiterature(dataDir: string, docId: string): Promise<boolean> {
  const f = fileOf(dataDir, docId);
  const had = await readFile(f).then(() => true, () => false);
  await rm(f, { force: true });
  return had;
}
