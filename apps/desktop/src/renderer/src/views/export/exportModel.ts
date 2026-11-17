import type { ExportPreset } from '@rl/core';

/** What the dialog edits: the selection (a union) and the options of an export preset. */
export interface Draft {
  projectId: string;
  folders: string[];
  tagIds: string[];
  clusters: Array<{ id: string; label: string }>;
  docIds: string[];
  includeCited: boolean;
  citedDepth: number;
  sources: 'none' | 'paths' | 'copies';
  includeNotes: boolean;
  includeAnnotations: boolean;
}

/** The selection as the `export:*` channels take it (all fields present: the contract's defaults are not relied on). */
export interface WireSelection {
  projectId?: string;
  folders: string[];
  tagIds: string[];
  clusterIds: string[];
  docIds: string[];
  includeCited: boolean;
  citedDepth: number;
  sources: 'none' | 'paths' | 'copies';
  includeNotes: boolean;
  includeAnnotations: boolean;
}

export const emptyDraft = (): Draft => ({
  projectId: '',
  folders: [],
  tagIds: [],
  clusters: [],
  docIds: [],
  includeCited: false,
  citedDepth: 1,
  sources: 'paths',
  includeNotes: true,
  includeAnnotations: true,
});

export const hasSelection = (d: Draft): boolean => d.projectId !== '' || d.folders.length + d.tagIds.length + d.clusters.length + d.docIds.length > 0;

export function toSelection(d: Draft): WireSelection {
  return {
    ...(d.projectId ? { projectId: d.projectId } : {}),
    folders: d.folders,
    tagIds: d.tagIds,
    clusterIds: d.clusters.map((c) => c.id),
    docIds: d.docIds,
    includeCited: d.includeCited,
    citedDepth: d.citedDepth,
    sources: d.sources,
    includeNotes: d.includeNotes,
    includeAnnotations: d.includeAnnotations,
  };
}

export function fromSelection(s: WireSelection): Draft {
  return { ...emptyDraft(), ...s, projectId: s.projectId ?? '', clusters: s.clusterIds.map((id) => ({ id, label: id })) };
}

export const applyPreset = (d: Draft, p: ExportPreset): Draft => ({
  ...d,
  includeCited: p.includeCited,
  citedDepth: p.citedDepth,
  sources: p.sources,
  includeNotes: p.includeNotes,
  includeAnnotations: p.includeAnnotations,
});

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const INVALID = /[<>:"/\|?*\u0000-\u001f]/;

/** Same rules as the contract (`exportTargetSchema`) plus the reserved names the main process refuses. */
export function folderNameValid(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= 120 && !INVALID.test(n) && n !== '.' && n !== '..' && !/[. ]$/.test(n) && !RESERVED.test(n);
}

/** A folder name made from free text: invalid characters become `-`, no trailing dots or spaces, at most 120 characters. */
export function sanitizeFolderName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let n = raw.replace(/[<>:"/\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/-{2,}/g, '-').trim().slice(0, 120);
  n = n.replace(/[. -]+$/, '').replace(/^[. ]+/, '');
  return RESERVED.test(n) ? `${n}-export` : n;
}

/** An export written earlier from this computer: what it was made from and where, so it can be updated in place. */
export interface PastExport {
  folderName: string;
  destination: string;
  at: string;
  selection: WireSelection;
}

const KEEP = 5;
const key = (libraryId: string) => `rl.exports.${libraryId}`;

export function loadPast(libraryId: string): PastExport[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key(libraryId)) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as PastExport[]).filter((p) => p && typeof p.folderName === 'string' && typeof p.destination === 'string' && p.selection && Array.isArray(p.selection.folders)) : [];
  } catch {
    return [];
  }
}

/** Remembers an export (most recent first, one entry per folder, at most five); storage that fails is ignored. */
export function rememberExport(libraryId: string, e: PastExport): void {
  try {
    const rest = loadPast(libraryId).filter((p) => !(p.destination === e.destination && p.folderName === e.folderName));
    window.localStorage.setItem(key(libraryId), JSON.stringify([e, ...rest].slice(0, KEEP)));
  } catch {
    // per-viewer convenience only
  }
}
