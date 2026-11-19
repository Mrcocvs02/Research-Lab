import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@rl/core';
import { readDocxHeadings } from './docx.js';
import { parseLatex, parseMarkdown, TEX_LIMITS, type Heading, type TexIo } from './headings.js';

export type SourceExt = 'md' | 'tex' | 'docx';
export interface SourceRead {
  ext: SourceExt;
  size: number;
  mtimeMs: number;
  headings: Heading[];
  read: { files: number; total: number };
}

const MAX_BYTES = { md: 16 * 1024 * 1024, tex: TEX_LIMITS.bytes, docx: 64 * 1024 * 1024 } as const;

export function extOf(file: string): SourceExt {
  const e = path.extname(file).toLowerCase().slice(1);
  if (e === 'md' || e === 'markdown') return 'md';
  if (e === 'tex' || e === 'docx') return e;
  throw new AppError('INVALID_REQUEST', 'Only .md, .tex and .docx manuscripts are supported', { reason: 'unsupported' });
}

const inside = (root: string, target: string): boolean => {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Reads (never writes) the headings of the manuscript file. `.tex` follows includes only inside the folder of the file. */
export async function readSource(file: string): Promise<SourceRead> {
  const ext = extOf(file);
  const st = await stat(file);
  if (!st.isFile()) throw new AppError('IO_ERROR', 'Not a file', { reason: 'not-file' });
  if (st.size > MAX_BYTES[ext]) throw new AppError('IO_ERROR', 'The manuscript file is too large', { reason: 'too-large' });
  const base = { ext, size: st.size, mtimeMs: st.mtimeMs };
  if (ext === 'md') return { ...base, headings: parseMarkdown(await readFile(file, 'utf8')), read: { files: 1, total: 1 } };
  if (ext === 'docx') return { ...base, headings: readDocxHeadings(await readFile(file)), read: { files: 1, total: 1 } };
  const real = await realpath(file);
  const root = path.dirname(real);
  const io: TexIo = {
    async resolve(target) {
      try {
        const lexical = path.resolve(root, target);
        if (!inside(root, lexical)) return null;
        const r = await realpath(lexical);
        return inside(root, r) ? r : null;
      } catch {
        return null;
      }
    },
    async read(p) {
      try {
        if ((await stat(p)).size > TEX_LIMITS.bytes) return null;
        return await readFile(p, 'utf8');
      } catch {
        return null;
      }
    },
  };
  const r = await parseLatex(await readFile(real, 'utf8'), io, real);
  return { ...base, headings: r.headings, read: r.read };
}
