import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError, documentIdSchema, TEMPLATE_LIMITS, type DocumentId } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';
import type { MainServices } from '../../ipc/handlers/services.js';

/**
 * Note templates (feature 35): `templates/<id>.md` in the data folder, a Markdown body with placeholders and a `name` in a
 * small front matter. The built-in "Letteratura" template (the seven sections of a literature note) is always offered; a file
 * with its id replaces it, and removing the file brings the built-in back. Loaded on demand (dynamic import behind the handler).
 */
export const BUILTIN_ID = 'letteratura';
const ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const MAX_FILE = 64 * 1024;

export interface Template {
  id: string;
  name: string;
  body: string;
  builtin: boolean;
}

const BUILTIN: Record<'it' | 'en', { name: string; body: string }> = {
  it: {
    name: 'Letteratura',
    body: '# {{titolo}}\n{{autori}} · {{anno}}\n\n## Problema\n{{problema}}\n\n## Contributo\n{{contributo}}\n\n## Metodo\n{{metodo}}\n\n## Risultati\n{{risultati}}\n\n{{evidenziazioni}}\n\n## Dati usati\n{{dati}}\n\n## Figure e grafici\n{{figure}}\n\n## Limiti e prospettive\n{{limiti}}\n',
  },
  en: {
    name: 'Literature',
    body: '# {{titolo}}\n{{autori}} · {{anno}}\n\n## Problem\n{{problema}}\n\n## Contribution\n{{contributo}}\n\n## Method\n{{metodo}}\n\n## Results\n{{risultati}}\n\n{{evidenziazioni}}\n\n## Data used\n{{dati}}\n\n## Figures and charts\n{{figure}}\n\n## Limits and outlook\n{{limiti}}\n',
  },
};

export const builtinTemplate = (language: 'it' | 'en'): Template => ({ id: BUILTIN_ID, ...BUILTIN[language], builtin: true });

/** Fills `{{name}}` placeholders; an unknown or empty one disappears, and a run of blank lines left behind collapses. */
export function fillTemplate(body: string, values: Readonly<Record<string, string>>): string {
  return body
    .replace(/\{\{\s*([a-z]+)\s*\}\}/g, (_m, k: string) => values[k] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trimStart();
}

/** `A b` -> `a-b`: the file name of a template made from its name. */
export function slugOf(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return s === '' ? 'template' : s;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseTemplate(id: string, raw: string): Template {
  const m = FM.exec(raw);
  const name = m ? /^name:\s*(.*)$/m.exec(m[1]!)?.[1]?.trim() : undefined;
  return { id, name: name && name !== '' ? name.slice(0, TEMPLATE_LIMITS.name) : id, body: raw.replace(FM, ''), builtin: false };
}
export const serializeTemplate = (name: string, body: string): string => `---\nname: ${name.replace(/[\r\n]+/g, ' ').trim()}\n---\n${body}`;

async function context(s: MainServices): Promise<{ dir: string; language: 'it' | 'en' }> {
  const rt = await s.runtime.require();
  return { dir: path.join(rt.store.dataDir, 'templates'), language: (await rt.store.readConfig()).language };
}

export async function listTemplates(s: MainServices): Promise<{ items: Template[] }> {
  const { dir, language } = await context(s);
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((n) => n.endsWith('.md') && ID.test(n.slice(0, -3)))
    .sort()
    .slice(0, TEMPLATE_LIMITS.count);
  const items: Template[] = [];
  for (const n of names) {
    const f = path.join(dir, n);
    const size = (await stat(f).catch(() => null))?.size ?? 0;
    if (size > MAX_FILE) continue;
    const raw = await readFile(f, 'utf8').catch(() => null);
    if (raw !== null) items.push(parseTemplate(n.slice(0, -3), raw));
  }
  if (!items.some((t) => t.id === BUILTIN_ID)) items.unshift(builtinTemplate(language));
  return { items };
}

export async function saveTemplate(s: MainServices, req: { id?: string | undefined; name: string; body: string }): Promise<{ item: Template }> {
  const { dir } = await context(s);
  const taken = new Set((await listTemplates(s)).items.map((t) => t.id));
  let id = req.id ?? slugOf(req.name);
  if (!ID.test(id)) throw new AppError('INVALID_REQUEST', 'Invalid template id');
  // A new template never replaces another one: a clash gets a number.
  if (req.id === undefined) for (let n = 2; taken.has(id); n++) id = `${slugOf(req.name)}-${n}`;
  else if (!taken.has(id) && taken.size >= TEMPLATE_LIMITS.count) throw new AppError('INVALID_REQUEST', 'Too many templates');
  await mkdir(dir, { recursive: true });
  const raw = serializeTemplate(req.name, req.body);
  await atomicWriteFile(path.join(dir, `${id}.md`), raw);
  return { item: parseTemplate(id, raw) };
}

export async function removeTemplate(s: MainServices, req: { id: string }): Promise<{ removed: boolean }> {
  if (!ID.test(req.id)) throw new AppError('INVALID_REQUEST', 'Invalid template id');
  const { dir } = await context(s);
  const f = path.join(dir, `${req.id}.md`);
  const had = await stat(f).then(() => true, () => false);
  await rm(f, { force: true });
  return { removed: had };
}

/** `> «text» ([p. N](lab://doc/<id>?page=N))` for each highlight of the user, in page order (at most 30, 300 characters each). */
export function highlightsBlock(docId: string, anns: ReadonlyArray<{ kind: string; page: number; text: string }>): string {
  return anns
    .filter((a) => a.kind !== 'area' && a.text.trim() !== '')
    .sort((a, b) => a.page - b.page)
    .slice(0, 30)
    .map((a) => `> «${a.text.replace(/\s+/g, ' ').trim().slice(0, 300)}» ([p. ${a.page}](lab://doc/${docId}?page=${a.page}))`)
    .join('\n');
}

/** The crops of the user as `p. N: caption` links (the pictures themselves stay in the reader). */
export function figuresBlock(docId: string, anns: ReadonlyArray<{ kind: string; page: number; crop?: { type: string; caption?: string | undefined } | undefined }>): string {
  return anns
    .filter((a) => a.kind === 'area')
    .sort((a, b) => a.page - b.page)
    .slice(0, 30)
    .map((a) => `- [p. ${a.page}](lab://doc/${docId}?page=${a.page}) ${a.crop?.caption?.replace(/\s+/g, ' ').trim() ?? a.crop?.type ?? ''}`.trimEnd())
    .join('\n');
}

/** The values of the metadata placeholders of a document, from its record and the user's annotations only (nothing is sent anywhere). */
export async function docValues(s: MainServices, docId: string): Promise<Record<string, string>> {
  const rt = await s.runtime.require();
  const id = documentIdSchema.parse(docId) as DocumentId;
  const rec = await rt.store.documents.get(id);
  if (!rec) throw new AppError('NOT_FOUND', 'Unknown document');
  const anns = (await rt.store.annotations.get(id))?.annotations ?? [];
  return {
    titolo: rec.title ?? path.basename(rec.path).replace(/\.[^.]+$/, ''),
    autori: rec.authors.join(', '),
    anno: rec.year ? String(rec.year) : '',
    evidenziazioni: highlightsBlock(id, anns),
    figure: figuresBlock(id, anns),
  };
}

export async function applyTemplate(s: MainServices, req: { id: string; docId: string }): Promise<{ text: string }> {
  const t = (await listTemplates(s)).items.find((x) => x.id === req.id);
  if (!t) throw new AppError('NOT_FOUND', 'Unknown template');
  return { text: fillTemplate(t.body, await docValues(s, req.docId)) };
}
