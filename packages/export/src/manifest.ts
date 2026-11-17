/** Name of the manifest that ties an export folder to its library (hidden file at the top of the folder). */
export const MANIFEST_FILE = '.research-lab-export.json';
export const MANIFEST_FORMAT = 1;

export interface ManifestFile {
  /** Hash of the whole file as written (files without markers). */
  whole?: string;
  /** Hash of each generated part as written (files with markers). */
  parts?: Record<string, string>;
  /** Size in bytes of a copy in `sources/` as the export wrote it (copies are not hashed: they can be large). */
  size?: number;
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

const CITEKEY = /^[a-z0-9]{1,80}$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** True for a citekey the export itself could have made: it names a file and sits inside `[[ ]]`, so nothing else goes. */
export const isValidCitekey = (k: string): boolean => CITEKEY.test(k) && !RESERVED.test(k);

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
  // A hand-edited manifest is not trusted: an entry whose citekey is not one of ours (separators, reserved names, `]]`,
  // line breaks) or repeats another is dropped, and the document gets a fresh key.
  const seen = new Set<string>();
  for (const [id, k] of Object.entries(citekeys)) {
    if (!isValidCitekey(k) || seen.has(k)) delete citekeys[id];
    else seen.add(k);
  }
  for (const [id, t] of Object.entries(titles)) titles[id] = t.replace(/\s+/g, ' ').slice(0, 300);
  const files: Record<string, ManifestFile> = {};
  for (const [rel, f] of Object.entries(v['files'])) {
    if (!isRecord(f)) return null;
    const parts = f['parts'] === undefined ? undefined : strMap(f['parts']);
    if (parts === null || (f['whole'] !== undefined && typeof f['whole'] !== 'string')) return null;
    const size = f['size'];
    files[rel] = { ...(typeof f['whole'] === 'string' ? { whole: f['whole'] } : {}), ...(parts ? { parts } : {}), ...(typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? { size } : {}) };
  }
  return { format: MANIFEST_FORMAT, libraryId: v['libraryId'], exportedAt: v['exportedAt'], citekeys, titles, files };
}

export const serializeManifest = (m: ExportManifest): string => `${JSON.stringify(m, null, 1)}\n`;
