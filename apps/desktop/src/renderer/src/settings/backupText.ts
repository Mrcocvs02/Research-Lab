import type { TFunction } from 'i18next';
import type { BackupJobStatus } from '@rl/core';
import { errorMessage } from '../lib/errors';
import { RlError } from '../lib/rl-error';
import { formatSize } from '../views/library/formatSize';

/** Reasons of CONFLICT / INVALID_REQUEST that the backup and restore flows explain themselves (`backup.errors.<reason>`). */
export const BACKUP_REASONS = ['no-destination', 'inside-library', 'too-large', 'not-enough-space', 'not-empty', 'already-registered', 'integrity', 'newer-format', 'not-a-backup', 'file-not-approved', 'file-not-listed', 'invalid-path', 'running', 'busy'] as const;
type Reason = (typeof BACKUP_REASONS)[number];

/** Optional fields the main process adds to the results (D-300); typed here so the code works before and after the contract has them. */
export type ResetSetting = 'mcp' | 'mcp-write' | 'confirm-before-send';
export type BackupResultExt = BackupJobStatus['result'] & { skipped?: number; resetOnRestore?: ResetSetting[] };

const isReason = (r: unknown): r is Reason => typeof r === 'string' && (BACKUP_REASONS as readonly string[]).includes(r);

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

function reasonText(reason: Reason, details: Record<string, unknown> | undefined, t: TFunction): string {
  return t(`backup.errors.${reason}`, { needed: formatSize(num(details?.needed)), free: formatSize(num(details?.free)), count: num(details?.count) });
}

/** Text of a failed backup call: the conflicts have their own explanation, the rest the shared messages. */
export function backupErrorText(e: unknown, t: TFunction): string {
  const err = RlError.from(e);
  const reason = err.details?.reason;
  if ((err.code === 'CONFLICT' || err.code === 'INVALID_REQUEST') && isReason(reason)) return reasonText(reason, err.details, t);
  return errorMessage(e, t);
}

/**
 * Text of the error of a finished job (`{ code, message, reason? }`): `reason` first; for an older main without it, the
 * message prefix `<reason>: ` (exactly, never a substring); the rest falls back to the shared messages.
 */
export function jobErrorText(error: { code: string; message: string; reason?: string | undefined } | null, t: TFunction): string {
  if (!error) return t('backup.errors.unknown');
  if (isReason(error.reason)) return reasonText(error.reason, undefined, t);
  const prefix = /^([a-z][a-z-]*): /.exec(error.message)?.[1];
  if (isReason(prefix)) return reasonText(prefix, undefined, t);
  return errorMessage(new RlError(error.code, error.message), t);
}

/** Text for the code of the last automatic backup problem (`lastAutoError`). */
export function autoErrorText(code: string, t: TFunction): string {
  return isReason(code) ? reasonText(code, undefined, t) : t('backup.autoErrorOther', { code });
}

/** Days since an ISO date (null for an invalid one). */
export function daysSince(iso: string, now = Date.now()): number | null {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.floor((now - at) / 86_400_000) : null;
}

/** A backup older than this many days earns a notice in the settings (D-262). */
export const STALE_BACKUP_DAYS = 30;
