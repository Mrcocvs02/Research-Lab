import { endsWithSpaceOrDot, INBOX_LIMITS, isReservedWindowsName } from '@rl/core';

/** Characters Windows refuses in a file name, plus control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;

/** A name that is safe as one path segment on Windows (and everywhere else): no unsafe characters, no reserved device name, no trailing dot or space. */
export function safeSegment(text: string, max: number): string {
  let t = text.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max).trim();
  while (t && endsWithSpaceOrDot(t)) t = t.slice(0, -1);
  if (t && isReservedWindowsName(t)) t = `_${t}`;
  return t;
}

/** Family name of an author written "Given Family" or "Family, Given". */
export function familyName(author: string): string {
  const a = author.trim();
  if (a.includes(',')) return a.split(',')[0]!.trim();
  const parts = a.split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

/**
 * `<first author family name> <year> - <title>.pdf`, Windows-safe and at most `INBOX_LIMITS.name` characters.
 * Falls back to the original name when there is no title to build it from.
 */
export function proposedFileName(meta: { title?: string | null | undefined; authors?: readonly string[] | undefined; year?: number | null | undefined }, original: string): string {
  // The original name is whatever the file system gave (an alternate data stream, a reserved name): a safe segment too.
  const fallback = `${safeSegment(original.replace(/\.pdf$/i, ''), INBOX_LIMITS.name - 4) || 'document'}.pdf`;
  const title = meta.title?.trim();
  if (!title) return fallback;
  const lead = [meta.authors?.[0] ? familyName(meta.authors[0]) : '', meta.year ? String(meta.year) : ''].filter(Boolean).join(' ');
  const stem = safeSegment(lead ? `${lead} - ${title}` : title, INBOX_LIMITS.name - 4);
  return stem ? `${stem}.pdf` : fallback;
}

/** True when `name` can be the file name of a copy: one segment, `.pdf`, safe, within the limit. */
export function isValidCopyName(name: string): boolean {
  return /\.pdf$/i.test(name) && name.length <= INBOX_LIMITS.name && safeSegment(name, INBOX_LIMITS.name) === name && !name.startsWith('.');
}
