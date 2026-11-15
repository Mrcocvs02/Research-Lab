/**
 * Pure (isomorphic) checks for names that are unsafe on Windows file systems. Used for
 * relative-path segments, library data folder names and item ids (which become file names).
 */

/**
 * Legacy DOS device names. They are reserved with any extension (`CON.txt`) and, on Windows,
 * also with trailing spaces before the extension (`con .txt`). Includes the superscript
 * variants of COM/LPT 1-3 that Windows also treats as devices.
 */
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

/** True when `segment` (a single file or folder name) is a reserved Windows device name. */
export function isReservedWindowsName(segment: string): boolean {
  const base = (segment.split('.')[0] ?? '').replace(/[ ]+$/, '');
  return RESERVED.test(base);
}

/** Windows silently strips trailing spaces and dots, so `foo.` and `foo` would be the same file. */
export function endsWithSpaceOrDot(segment: string): boolean {
  return /[ .]$/.test(segment);
}
