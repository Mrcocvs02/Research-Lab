/** A file size for people: bytes, KB or MB (binary units, one decimal under 10), e.g. `842 B`, `3.4 KB`, `12 MB`. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const unit = (v: number, name: string) => `${v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString()} ${name}`;
  if (bytes < 1024 * 1024) return unit(bytes / 1024, 'KB');
  if (bytes < 1024 ** 3) return unit(bytes / 1024 ** 2, 'MB');
  return unit(bytes / 1024 ** 3, 'GB');
}
