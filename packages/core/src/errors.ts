import { z } from 'zod';

export const ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_RESPONSE',
  'UNKNOWN_CHANNEL',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'CONFLICT',
  'INVALID_PATH',
  'PATH_OUTSIDE_ROOT',
  'IO_ERROR',
  'SCHEMA_INVALID',
  'NOT_IMPLEMENTED',
  'PERMISSION_DENIED',
  'LIBRARY_NOT_ACTIVE',
  'FOLDER_NOT_AI_ENABLED',
  'AI_BUDGET_EXCEEDED',
  'AI_PROVIDER_ERROR',
  /** An online source (OpenAlex, arXiv, Semantic Scholar) could not be reached; `details.reason` says why. */
  'NETWORK_ERROR',
  'SECRET_UNAVAILABLE',
  'READ_ONLY',
  'CANCELLED',
  'INTERNAL',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Wire form of an error: structured-clone friendly, no stack, no secrets. */
export const serializedErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type SerializedError = z.infer<typeof serializedErrorSchema>;

/** The only error type that crosses package and process boundaries on purpose. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON(): SerializedError {
    return this.details ? { code: this.code, message: this.message, details: this.details } : { code: this.code, message: this.message };
  }

  static from(value: unknown): AppError {
    if (value instanceof AppError) return value;
    const parsed = serializedErrorSchema.safeParse(value);
    if (parsed.success) return new AppError(parsed.data.code, parsed.data.message, parsed.data.details);
    const message = value instanceof Error ? value.message : 'Unexpected error';
    return new AppError('INTERNAL', message, undefined, { cause: value });
  }
}

export function isAppError(value: unknown, code?: ErrorCode): value is AppError {
  return value instanceof AppError && (code === undefined || value.code === code);
}
