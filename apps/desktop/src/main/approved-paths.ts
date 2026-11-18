import path from 'node:path';

/** What the user picked a path for. An approval is valid for that purpose only. */
export type ApprovalPurpose = 'library-root' | 'legacy-index' | 'export-destination' | 'taxonomy-file' | 'backup-destination' | 'backup-file' | 'bib-source' | 'resource-file' | 'resource-folder';

export interface ApprovedPathsOptions {
  /** Path semantics to use (default: the running platform). Lets tests cover Windows rules anywhere. */
  platform?: NodeJS.Platform;
}

/**
 * Absolute paths the user picked through a native dialog in this session, each bound to the
 * purpose of the dialog. The renderer may only hand back such a path, for that same purpose:
 * a folder picked as an import source is not a valid library root, and so on.
 *
 * Matching is by exact path (after normalisation), never by prefix: approving a folder does
 * not approve its sub-folders or its parent. Normalisation resolves `.`/`..` and duplicate
 * or mixed separators, strips the Windows extended prefix (`\\?\C:\x` is `C:\x`, `\\?\UNC\s\x`
 * is `\\s\x`), drops a trailing separator and compares case-insensitively on Windows. Device
 * namespace paths (`\\.\...`) are never accepted.
 */
export class ApprovedPaths {
  private readonly byPurpose = new Map<ApprovalPurpose, Set<string>>();
  private readonly win: boolean;
  private readonly p: typeof path.posix;

  constructor(options: ApprovedPathsOptions = {}) {
    this.win = (options.platform ?? process.platform) === 'win32';
    this.p = this.win ? path.win32 : path.posix;
  }

  /** Native absolute form without the extended prefix (case kept), or null when not acceptable. */
  private canonical(input: string): string | null {
    if (typeof input !== 'string' || input === '' || input.includes('\0')) return null;
    let s = input;
    if (this.win) {
      if (/^[\\/]{2}[.][\\/]/.test(s)) return null;
      s = s.replace(/^[\\/]{2}[?][\\/]UNC[\\/]/i, '\\\\').replace(/^[\\/]{2}[?][\\/]/, '');
    }
    if (!this.p.isAbsolute(s)) return null;
    // Rooted but drive-less (`\Lib`) would mean "the current drive": ambiguous, refuse.
    if (this.win && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/.test(s)) return null;
    return this.p.resolve(s);
  }

  private normalise(input: string): string | null {
    const c = this.canonical(input);
    return c === null ? null : this.win ? c.toLowerCase() : c;
  }

  add(p: string, purpose: ApprovalPurpose): void {
    const key = this.normalise(p);
    if (key === null) return;
    let set = this.byPurpose.get(purpose);
    if (!set) this.byPurpose.set(purpose, (set = new Set()));
    set.add(key);
  }

  /** The canonical path to use when `p` is approved for `purpose` (never the renderer's spelling), else null. */
  resolve(p: string, purpose: ApprovalPurpose): string | null {
    return this.has(p, purpose) ? this.canonical(p) : null;
  }

  has(p: string, purpose: ApprovalPurpose): boolean {
    const key = this.normalise(p);
    return key !== null && (this.byPurpose.get(purpose)?.has(key) ?? false);
  }
}
