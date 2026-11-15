// Tree snapshots for the "non-destructive" guarantee (PLAN section 7): hash every file under a root
// before and after a test and report anything that changed. Self-contained on purpose: the
// check:nondestructive CLI loads this file directly with Node's type stripping (no relative imports,
// no enums, no parameter properties).
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface SnapshotEntry {
  type: 'file' | 'dir' | 'symlink';
  /** SHA-256 hex of the content (symlink: of the link target; dir: empty string). */
  sha256: string;
  size: number;
  /** Modification time in ms (directories: 0, their mtime changes with any child). */
  mtimeMs: number;
}

/** Key = path relative to the root, forward slashes; directories end with "/". */
export type Snapshot = Record<string, SnapshotEntry>;

export interface SnapshotOptions {
  /**
   * Paths (relative to the root, or absolute inside it) skipped together with everything below them,
   * typically the library data folder (`.lab`) and the export folders.
   */
  exclude?: string[];
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  /** Content (or type) changed. */
  modified: string[];
  /** Same content, different mtime: suspicious (a rewrite) but not data loss. */
  touched: string[];
  /** True when nothing was added, removed or modified (touched is ignored). */
  clean: boolean;
}

/** Windows: prefix long absolute paths with \\?\ so the 260 character limit does not apply. */
export function fsPath(p: string): string {
  if (process.platform !== 'win32') return p;
  const abs = path.resolve(p);
  if (abs.length < 240 || abs.startsWith('\\\\?\\')) return abs;
  return abs.startsWith('\\\\') ? '\\\\?\\UNC\\' + abs.slice(2) : '\\\\?\\' + abs;
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(fsPath(file))
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

export async function snapshotTree(root: string, options: SnapshotOptions = {}): Promise<Snapshot> {
  const absRoot = path.resolve(root);
  const excluded = new Set(
    (options.exclude ?? []).map((e) => normalizeRel(path.isAbsolute(e) ? path.relative(absRoot, e) : e)).filter((e) => e !== '' && !e.startsWith('..')),
  );
  const isExcluded = (rel: string) => {
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) if (excluded.has(parts.slice(0, i).join('/'))) return true;
    return false;
  };
  const out: Snapshot = {};

  async function walk(rel: string): Promise<void> {
    const entries = await readdir(fsPath(path.join(absRoot, rel)), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (isExcluded(childRel)) continue;
      const abs = path.join(absRoot, childRel);
      if (e.isSymbolicLink()) {
        const target = await readlink(fsPath(abs));
        const st = await lstat(fsPath(abs));
        out[childRel] = { type: 'symlink', sha256: createHash('sha256').update(target).digest('hex'), size: target.length, mtimeMs: Math.round(st.mtimeMs) };
      } else if (e.isDirectory()) {
        out[childRel + '/'] = { type: 'dir', sha256: '', size: 0, mtimeMs: 0 };
        await walk(childRel);
      } else if (e.isFile()) {
        const st = await lstat(fsPath(abs));
        out[childRel] = { type: 'file', sha256: await hashFile(abs), size: st.size, mtimeMs: Math.round(st.mtimeMs) };
      }
    }
  }
  await walk('');
  return out;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const touched: string[] = [];
  for (const [key, a] of Object.entries(before)) {
    const b = after[key];
    if (!b) removed.push(key);
    else if (a.type !== b.type || a.sha256 !== b.sha256 || a.size !== b.size) modified.push(key);
    else if (a.mtimeMs !== b.mtimeMs) touched.push(key);
  }
  for (const key of Object.keys(after)) if (!before[key]) added.push(key);
  for (const list of [added, removed, modified, touched]) list.sort();
  return { added, removed, modified, touched, clean: added.length + removed.length + modified.length === 0 };
}

export function formatDiff(diff: SnapshotDiff): string {
  const lines: string[] = [];
  for (const [label, list] of [['added', diff.added], ['removed', diff.removed], ['modified', diff.modified], ['touched (mtime only)', diff.touched]] as const) {
    for (const p of list) lines.push(`${label}: ${p}`);
  }
  return lines.join('\n');
}

export async function saveSnapshot(file: string, snapshot: Snapshot): Promise<void> {
  await writeFile(file, JSON.stringify({ version: 1, snapshot }, null, 1));
}

export async function loadSnapshot(file: string): Promise<Snapshot> {
  const data = JSON.parse(await readFile(file, 'utf8')) as { version?: number; snapshot?: Snapshot };
  if (data.version !== 1 || !data.snapshot) throw new Error('Not a snapshot file');
  return data.snapshot;
}
