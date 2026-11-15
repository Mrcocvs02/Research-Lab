import path from 'node:path';

const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

/**
 * Absolute folders the user picked through the native dialog in this session.
 * The renderer may only hand back such paths (library root, import source).
 */
export class ApprovedPaths {
  private readonly set = new Set<string>();

  add(p: string): void {
    this.set.add(norm(p));
  }

  has(p: string): boolean {
    return path.isAbsolute(p) && this.set.has(norm(p));
  }
}
