import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { documentIdSchema, itemIdSchema, type DocumentId } from '@rl/core';
import type { MainServices } from '../../ipc/handlers/services.js';

/**
 * Links between notes (feature 38): a link is saved by IDENTIFIER, `[[Title|lab://doc/<id>]]` (or `lab://project/<id>`), and the
 * title is read again when the note is shown, so renaming never breaks it. The index of who links to whom is made from the
 * notes of the data folder and kept in memory per library (a file is read again only when its size or time changed); it can
 * always be rebuilt from the notes. Loaded on demand (dynamic import behind the IPC handler).
 */
const LINK = /\[\[[^\]|]{1,300}\|lab:\/\/doc\/([0-9a-f]{16})(?:\?page=[1-9][0-9]{0,5})?\]\]/g;
const MAX_FILES = 20_000;
const MAX_BYTES = 2 * 1024 * 1024;

interface Entry {
  sig: string;
  targets: string[];
}
const indexes = new Map<string, Map<string, Entry>>();

/** The documents a note body links to. */
export function linkTargets(body: string): string[] {
  return [...new Set([...body.matchAll(LINK)].map((m) => m[1]!))];
}

/** `<id>.md` is the file note of `<id>`; `<id>/p<N>.md` its page note. */
function ownerOf(rel: string): { docId: string; page: number | null } | null {
  const m = /^([0-9a-f]{16})\.md$/.exec(rel) ?? null;
  if (m) return { docId: m[1]!, page: null };
  const p = /^([0-9a-f]{16})\/p(\d+)\.md$/.exec(rel);
  return p ? { docId: p[1]!, page: Number(p[2]) } : null;
}

async function noteFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isFile()) out.push(e.name);
    else if (e.isDirectory() && /^[0-9a-f]{16}$/.test(e.name)) for (const n of await readdir(path.join(dir, e.name)).catch(() => [] as string[])) out.push(`${e.name}/${n}`);
    if (out.length > MAX_FILES) break;
  }
  return out.slice(0, MAX_FILES);
}

async function refresh(dataDir: string): Promise<Map<string, Entry>> {
  const dir = path.join(dataDir, 'notes');
  const idx = indexes.get(dataDir) ?? new Map<string, Entry>();
  indexes.set(dataDir, idx);
  const files = (await noteFiles(dir)).filter((f) => ownerOf(f) !== null);
  const live = new Set(files);
  for (const k of idx.keys()) if (!live.has(k)) idx.delete(k);
  for (let i = 0; i < files.length; i += 16) {
    await Promise.all(
      files.slice(i, i + 16).map(async (rel) => {
        const f = path.join(dir, ...rel.split('/'));
        const st = await stat(f).catch(() => null);
        if (!st || st.size > MAX_BYTES) return void idx.delete(rel);
        const sig = `${st.size}:${st.mtimeMs}`;
        if (idx.get(rel)?.sig === sig) return;
        const body = await readFile(f, 'utf8').catch(() => '');
        idx.set(rel, { sig, targets: linkTargets(body) });
      }),
    );
  }
  return idx;
}

export async function incomingLinks(s: MainServices, req: { docId: string }) {
  const rt = await s.runtime.require();
  const target = documentIdSchema.parse(req.docId);
  const idx = await refresh(rt.store.dataDir);
  const found: Array<{ docId: string; page: number | null }> = [];
  for (const [rel, e] of idx) {
    const o = ownerOf(rel);
    if (o && o.docId !== target && e.targets.includes(target)) found.push(o);
  }
  found.sort((a, b) => a.docId.localeCompare(b.docId) || (a.page ?? 0) - (b.page ?? 0));
  const items = [];
  for (const f of found.slice(0, 100)) {
    const rec = await rt.store.documents.get(f.docId as DocumentId).catch(() => null);
    if (rec) items.push({ docId: f.docId, page: f.page, title: rec.title ?? path.basename(rec.path) });
  }
  return { items };
}

export async function linkTitles(s: MainServices, req: { docIds: string[]; projectIds: string[] }) {
  const rt = await s.runtime.require();
  const docs: Record<string, string> = {};
  const projects: Record<string, string> = {};
  for (const id of req.docIds) {
    const rec = await rt.store.documents.get(id as DocumentId).catch(() => null);
    if (rec) docs[id] = rec.title ?? path.basename(rec.path);
  }
  for (const id of req.projectIds) {
    const p = await rt.store.projects.get(itemIdSchema.parse(id)).catch(() => null);
    if (p) projects[id] = p.name;
  }
  return { docs, projects };
}

export async function suggestLinks(s: MainServices, req: { query: string }) {
  const rt = await s.runtime.require();
  const q = req.query.trim();
  const hits = await rt.search({ text: q, limit: 8 }).catch(() => ({ hits: [] as Array<{ docId: string; title: string | null; path: string }> }));
  const items: Array<{ kind: 'doc' | 'project'; id: string; title: string }> = hits.hits.map((h) => ({ kind: 'doc', id: h.docId, title: h.title ?? path.basename(h.path) }));
  const needle = q.toLowerCase();
  const projects = (await rt.store.projects.list().catch(() => [])).filter((p) => needle === '' || p.name.toLowerCase().includes(needle)).slice(0, 4);
  for (const p of projects) items.push({ kind: 'project', id: p.id, title: p.name });
  return { items: items.slice(0, 12) };
}
