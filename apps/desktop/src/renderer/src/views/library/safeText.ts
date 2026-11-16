/**
 * Text from documents is data: it is always rendered as text nodes. Bidirectional controls (embeddings,
 * overrides, isolates) are removed so a title cannot reorder the text around it, and other control
 * characters are dropped (the snippet markers are split off before this runs).
 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export function safeText(s: string): string {
  return s.replace(UNSAFE, '');
}
