import { AppError } from '@rl/core';

/**
 * Why an extraction failed, as `details.reason` of the thrown `AppError`.
 *
 * PERMANENT: the same bytes will fail the same way. Do not retry until the file's content hash changes.
 * TRANSIENT: the file or the disk was momentarily unavailable. Retry later, with a back-off.
 * Cancellation (`AppError('CANCELLED')`) is neither: the caller asked for it.
 */
export const PERMANENT_EXTRACT_REASONS = ['malformed', 'encrypted', 'too-large', 'unsupported-format', 'timeout'] as const;
export const TRANSIENT_EXTRACT_REASONS = ['busy', 'not-found', 'io'] as const;

export type PermanentExtractReason = (typeof PERMANENT_EXTRACT_REASONS)[number];
export type TransientExtractReason = (typeof TRANSIENT_EXTRACT_REASONS)[number];
export type ExtractFailureKind = 'permanent' | 'transient' | 'cancelled';

/** `details.reason` of an extraction error, if it carries one. */
export function extractErrorReason(e: unknown): string | undefined {
  const reason = e instanceof AppError ? (e.details as { reason?: unknown } | undefined)?.reason : undefined;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * Whether a failed extraction is worth retrying. Anything not recognised (including non-AppError failures) is
 * `transient`: the runtime should retry it a bounded number of times, never forever.
 */
export function classifyExtractError(e: unknown): ExtractFailureKind {
  if (e instanceof AppError && e.code === 'CANCELLED') return 'cancelled';
  const reason = extractErrorReason(e);
  if (reason !== undefined && (PERMANENT_EXTRACT_REASONS as readonly string[]).includes(reason)) return 'permanent';
  return 'transient';
}
