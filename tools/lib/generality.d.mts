export interface Finding {
  file: string;
  line: number;
  rule: string;
}
export const ALLOW_MARKER: string;
export function loadLocalPatterns(root: string): string[];
export function scanText(text: string, localPatterns?: string[]): { line: number; rule: string; allowed: boolean }[];
export function listFiles(root: string): string[];
export function scanGenerality(opts: { root: string; localPatterns?: string[] }): { violations: Finding[]; allowed: Finding[]; scanned: number };
