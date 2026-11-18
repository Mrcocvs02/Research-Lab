/** Days since an ISO date (null for an invalid one). */
export function daysSince(iso: string, now = Date.now()): number | null {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.floor((now - at) / 86_400_000) : null;
}

/** A backup older than this many days earns a notice in the settings (D-262). */
export const STALE_BACKUP_DAYS = 30;
