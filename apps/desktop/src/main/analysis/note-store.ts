import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataPath, documentIdSchema } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';

/** Front matter of the AI literature note file: the file is AI-owned and stays a proposal until the user reviews it. */
export interface NoteMeta {
  version: string;
  model: string;
  generatedAt: string;
  mode: 'single' | 'chapters';
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const fileOf = (dataDir: string, docId: string): string | null => (documentIdSchema.safeParse(docId).success ? path.join(dataDir, ...dataPath.literature(docId).split('/')) : null);

/** The literature note of a document (body without front matter), or null when there is none. Read-only. */
export async function readNote(dataDir: string, docId: string): Promise<string | null> {
  const f = fileOf(dataDir, docId);
  if (!f) return null;
  const raw = await readFile(f, 'utf8').catch(() => null);
  if (raw === null) return null;
  // The poor note made from the abstract (no model, folder not enabled) is not a summary of the document: the analysis does not derive from it (I2).
  if (/^abstractOnly:\s*true\s*$/m.test(FM.exec(raw)?.[1] ?? '')) return null;
  const body = raw.replace(FM, '').trim();
  return body.length > 0 ? body : null;
}

/** True when the user approved the note of this document: such a note is never replaced by a new generation (I2). */
export async function isApprovedNote(dataDir: string, docId: string): Promise<boolean> {
  const f = fileOf(dataDir, docId);
  if (!f) return false;
  const raw = await readFile(f, 'utf8').catch(() => null);
  const head = raw === null ? '' : (FM.exec(raw)?.[1] ?? '');
  return /^review:\s*approved\s*$/m.test(head) && !/^abstractOnly:\s*true\s*$/m.test(head);
}

/** Writes `literature/<docId>.md` in the data folder (atomic). The note is AI output: `ai: true`, `review: proposed`. */
export async function writeNote(dataDir: string, docId: string, body: string, meta: NoteMeta): Promise<void> {
  const f = fileOf(dataDir, docId);
  if (!f) throw new Error('Invalid document id');
  await mkdir(path.dirname(f), { recursive: true });
  const head = `---\ndocId: ${docId}\nai: true\nreview: proposed\nversion: ${meta.version}\nmodel: ${meta.model}\ngeneratedAt: ${meta.generatedAt}\nmode: ${meta.mode}\n---\n`;
  await atomicWriteFile(f, `${head}${body.trim()}\n`);
}
