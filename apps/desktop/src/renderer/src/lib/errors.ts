import { AppError, ERROR_CODES, type ErrorCode } from '@rl/core';
import type { TFunction } from 'i18next';

/** Localised, user-facing text for any thrown value. Never shows stacks or raw internals. */
export function errorMessage(error: unknown, t: TFunction): string {
  const err = AppError.from(error);
  const code: ErrorCode = (ERROR_CODES as readonly string[]).includes(err.code) ? err.code : 'INTERNAL';
  return t(`errors.${code}`);
}

/** Zod-style issues carried by INVALID_REQUEST errors (`details.issues`), as path -> message. */
export function issuesFromError(error: unknown): Record<string, string> {
  const err = AppError.from(error);
  const issues = err.details?.issues;
  const out: Record<string, string> = {};
  if (Array.isArray(issues)) {
    for (const i of issues as Array<{ path?: unknown; message?: unknown }>) {
      if (typeof i.path === 'string' && typeof i.message === 'string') out[i.path] = i.message;
    }
  }
  return out;
}
