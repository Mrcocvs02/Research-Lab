import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { itemIdSchema, manuscriptSchema, type Manuscript } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';

/**
 * `projects/<id>/manuscript.json` (synced with the library: sections and assignments) and, apart, the absolute path of the linked
 * file in `<localDataDir>/manuscripts.json`, which belongs to this machine and is never synced (a path means nothing elsewhere).
 */
const fileOf = (dataDir: string, projectId: string): string => path.join(dataDir, 'projects', itemIdSchema.parse(projectId), 'manuscript.json');

export async function readManuscript(dataDir: string, projectId: string): Promise<Manuscript | null> {
  const raw = await readFile(fileOf(dataDir, projectId), 'utf8').catch(() => null);
  if (raw === null) return null;
  try {
    const r = manuscriptSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function writeManuscript(dataDir: string, projectId: string, m: Manuscript): Promise<void> {
  const f = fileOf(dataDir, projectId);
  await mkdir(path.dirname(f), { recursive: true });
  await atomicWriteJson(f, manuscriptSchema.parse(m));
}

export const removeManuscript = (dataDir: string, projectId: string): Promise<void> => rm(fileOf(dataDir, projectId), { force: true });

const localFile = (localDataDir: string): string => path.join(localDataDir, 'manuscripts.json');
const keyOf = (libraryId: string, projectId: string): string => `${itemIdSchema.parse(libraryId)}/${itemIdSchema.parse(projectId)}`;

async function readLocal(localDataDir: string): Promise<Record<string, string>> {
  try {
    const v: unknown = JSON.parse(await readFile(localFile(localDataDir), 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, p]) => typeof p === 'string')) : {};
  } catch {
    return {};
  }
}

export async function readLocalPath(localDataDir: string, libraryId: string, projectId: string): Promise<string | null> {
  return (await readLocal(localDataDir))[keyOf(libraryId, projectId)] ?? null;
}

export async function writeLocalPath(localDataDir: string, libraryId: string, projectId: string, file: string | null): Promise<void> {
  const all = await readLocal(localDataDir);
  const k = keyOf(libraryId, projectId);
  if (file === null) delete all[k];
  else all[k] = file;
  await mkdir(localDataDir, { recursive: true });
  await atomicWriteJson(localFile(localDataDir), all);
}
