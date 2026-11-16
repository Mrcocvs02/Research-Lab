import { lstat, mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AGENT_GUIDE_FILE, AGENT_GUIDE_TEXT } from '@rl/ai';
import { dataPath } from '@rl/core';

const MAX_GUIDE_BYTES = 64 * 1024;

/**
 * Makes sure `<dataDir>/CLAUDE.md` exists (written once, with the starting text of the plan; never overwritten: the user
 * edits it) and returns its content for the system prompt. A guide that cannot be read falls back to the starting text.
 */
export async function ensureGuide(dataDir: string): Promise<string> {
  const file = path.join(dataDir, AGENT_GUIDE_FILE);
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(file, AGENT_GUIDE_TEXT, { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return AGENT_GUIDE_TEXT;
  }
  try {
    const st = await lstat(file);
    if (!st.isFile()) return AGENT_GUIDE_TEXT;
    const fh = await open(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(st.size, MAX_GUIDE_BYTES));
      await fh.read(buf, 0, buf.length, 0);
      const text = buf.toString('utf8').trim();
      return text === '' ? AGENT_GUIDE_TEXT : text;
    } finally {
      await fh.close();
    }
  } catch {
    return AGENT_GUIDE_TEXT;
  }
}

export interface UserCommand {
  id: string;
  label: string;
  prompt: string;
}

const NAME = /^([a-z0-9-]{1,64})\.md$/;
export const COMMAND_LIMITS = { files: 200, fileBytes: 64 * 1024, label: 200, prompt: 20_000 } as const;

/**
 * The user's commands: `<dataDir>/commands/*.md` (first line `# Label`, the rest is the prompt, the id is the file name).
 * Safe by construction: only names `[a-z0-9-]`, only regular files directly inside the folder (no links, no sub-folders),
 * size caps, never a path outside it. Anything else is skipped silently.
 */
export async function listUserCommands(dataDir: string): Promise<UserCommand[]> {
  const dir = path.join(dataDir, dataPath.commands);
  const st = await lstat(dir).catch(() => null);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) return [];
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => NAME.test(n)).sort();
  const out: UserCommand[] = [];
  for (const name of names) {
    if (out.length >= COMMAND_LIMITS.files) break;
    const file = path.join(dir, name);
    const fst = await lstat(file).catch(() => null);
    if (!fst || !fst.isFile() || fst.isSymbolicLink() || fst.size > COMMAND_LIMITS.fileBytes) continue;
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) continue;
    const id = NAME.exec(name)![1]!;
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const m = /^#\s+(.+?)\s*$/.exec(lines[0] ?? '');
    const label = m ? [...m[1]!].slice(0, COMMAND_LIMITS.label).join('') : id;
    const prompt = [...(m ? lines.slice(1) : lines).join('\n').trim()].slice(0, COMMAND_LIMITS.prompt).join('');
    if (prompt === '') continue;
    out.push({ id, label, prompt });
  }
  return out;
}
