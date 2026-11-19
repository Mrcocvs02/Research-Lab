type T = (key: string, options?: Record<string, unknown>) => string;
interface Drift {
  pending: number;
  changed?: number | undefined;
  removed: number;
}

/** The header of a Map that is out of date: documents new since the build, documents changed since (after a tidy-up, say), documents removed (D-508). */
export function staleLine(s: Drift, t: T): string {
  const changed = Math.min(s.changed ?? 0, s.pending);
  const fresh = s.pending - changed;
  const parts: string[] = [];
  if (fresh > 0) parts.push(t('network.head.stale', { count: fresh }));
  if (changed > 0) parts.push(t('network.head.changed', { count: changed }));
  if (s.removed > 0) parts.push(parts.length > 0 ? t('network.status.alsoRemoved', { count: s.removed }) : t('network.head.removed', { count: s.removed }));
  return parts.join(' · ');
}
