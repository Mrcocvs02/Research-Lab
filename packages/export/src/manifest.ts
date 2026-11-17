/** Name of the manifest that ties an export folder to its library (hidden file at the top of the folder). */
export const MANIFEST_FILE = '.research-lab-export.json';
export const MANIFEST_FORMAT = 1;

export interface ManifestFile {
  /** Hash of the whole file as written (files without markers). */
  whole?: string;
  /** Hash of each generated part as written (files with markers). */
  parts?: Record<string, string>;
}

export interface ExportManifest {
  format: typeof MANIFEST_FORMAT;
  libraryId: string;
  exportedAt: string;
  /** Document id to citekey: stable across exports, cards of documents that left the selection included. */
  citekeys: Record<string, string>;
  /** Document id to title, for listing the cards no longer exported. */
  titles: Record<string, string>;
  files: Record<string, ManifestFile>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strMap = (v: unknown): Record<string, string> | null => {
  if (!isRecord(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'string') return null;
    out[k] = x;
  }
  return out;
};

/** The manifest in `text`, or null when it is not one (not JSON, wrong shape, newer format). */
export function parseManifest(text: string): ExportManifest | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v) || v['format'] !== MANIFEST_FORMAT || typeof v['libraryId'] !== 'string' || typeof v['exportedAt'] !== 'string') return null;
  const citekeys = strMap(v['citekeys']);
  const titles = strMap(v['titles'] ?? {});
  if (!citekeys || !titles || !isRecord(v['files'])) return null;
  const files: Record<string, ManifestFile> = {};
  for (const [rel, f] of Object.entries(v['files'])) {
    if (!isRecord(f)) return null;
    const parts = f['parts'] === undefined ? undefined : strMap(f['parts']);
    if (parts === null || (f['whole'] !== undefined && typeof f['whole'] !== 'string')) return null;
    files[rel] = { ...(typeof f['whole'] === 'string' ? { whole: f['whole'] } : {}), ...(parts ? { parts } : {}) };
  }
  return { format: MANIFEST_FORMAT, libraryId: v['libraryId'], exportedAt: v['exportedAt'], citekeys, titles, files };
}

export const serializeManifest = (m: ExportManifest): string => `${JSON.stringify(m, null, 1)}\n`;
