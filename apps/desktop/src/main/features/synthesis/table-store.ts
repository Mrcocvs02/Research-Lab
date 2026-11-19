import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { compareTableSchema, itemIdSchema, type CompareTable } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';

/**
 * `projects/<projectId>/tables/<id>.md` (§17.4.7): a Markdown table anyone can read, with the data in the front matter as one JSON
 * line (`table:`), which is what is read back. A file that cannot be read is skipped. CSV is written only by "Esporta CSV".
 */
const dir = (dataDir: string, projectId: string) => path.join(dataDir, 'projects', itemIdSchema.parse(projectId), 'tables');
const fileOf = (dataDir: string, projectId: string, id: string) => path.join(dir(dataDir, projectId), `${itemIdSchema.parse(id)}.md`);

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function cellMarkdown(docId: string, c: CompareTable['rows'][number]['cells'][string] | undefined): string {
  if (!c) return '';
  if (c.text === '') return c.why === 'not-enabled' ? '—' : 'n/d';
  const pages = c.pages.map((p) => `[p. ${p}](lab://doc/${docId}?page=${p})`).join(', ');
  return esc(`${c.text}${pages ? ` (${pages})` : ''}${c.ai ? ' ✦' : ''}`);
}

export function tableMarkdown(t: CompareTable): string {
  const head = `| Paper | ${t.columns.map((c) => esc(c.name)).join(' | ')} |`;
  const sep = `| --- | ${t.columns.map(() => '---').join(' | ')} |`;
  const rows = t.rows.map((r) => `| [${esc(r.label)}](lab://doc/${r.docId}) | ${t.columns.map((c) => cellMarkdown(r.docId, r.cells[c.id])).join(' | ')} |`);
  return `---\nid: ${t.id}\nprojectId: ${t.projectId}\ntitle: ${t.title.replace(/[\r\n]+/g, ' ')}\ncreatedAt: ${t.createdAt}\nupdatedAt: ${t.updatedAt}\ntable: ${JSON.stringify(t)}\n---\n# ${t.title.replace(/[\r\n]+/g, ' ')}\n\n${[head, sep, ...rows].join('\n')}\n`;
}

export function parseTable(raw: string): CompareTable | null {
  const line = /^table:\s*(\{.*\})\s*$/m.exec(raw)?.[1];
  if (!line) return null;
  try {
    const r = compareTableSchema.safeParse(JSON.parse(line));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function readTable(dataDir: string, projectId: string, id: string): Promise<CompareTable | null> {
  const raw = await readFile(fileOf(dataDir, projectId, id), 'utf8').catch(() => null);
  return raw === null ? null : parseTable(raw);
}

export async function writeTable(dataDir: string, t: CompareTable): Promise<void> {
  await mkdir(dir(dataDir, t.projectId), { recursive: true });
  await atomicWriteFile(fileOf(dataDir, t.projectId, t.id), tableMarkdown(t));
}

export async function removeTable(dataDir: string, projectId: string, id: string): Promise<boolean> {
  const had = (await readTable(dataDir, projectId, id)) !== null;
  await rm(fileOf(dataDir, projectId, id), { force: true });
  return had;
}

export async function listTables(dataDir: string, projectId: string) {
  const names = await readdir(dir(dataDir, projectId)).catch(() => [] as string[]);
  const out: Array<{ id: string; title: string; updatedAt: string; docs: number; columns: number }> = [];
  for (const n of names) {
    if (!n.endsWith('.md')) continue;
    const t = await readTable(dataDir, projectId, n.slice(0, -3)).catch(() => null);
    if (t) out.push({ id: t.id, title: t.title, updatedAt: t.updatedAt, docs: t.rows.length, columns: t.columns.length });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

const csvCell = (s: string) => {
  // A cell that starts like a formula is neutralised (spreadsheet injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function tableCsv(t: CompareTable): string {
  const head = ['Paper', ...t.columns.map((c) => c.name)].map(csvCell).join(',');
  const rows = t.rows.map((r) =>
    [r.label, ...t.columns.map((c) => {
      const x = r.cells[c.id];
      return x ? `${x.text}${x.pages.length ? ` (p. ${x.pages.join(', ')})` : ''}` : '';
    })]
      .map(csvCell)
      .join(','),
  );
  return `﻿${[head, ...rows].join('\r\n')}\r\n`;
}
