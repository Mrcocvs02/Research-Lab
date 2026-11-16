/** An error that came back over IPC (same shape as `AppError` of `@rl/core`, without pulling zod into the first screen). */
export class RlError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  /** Any thrown value as an `RlError`: errors with a string `code` keep it (duck-typed), the rest become INTERNAL. */
  static from(value: unknown): RlError {
    if (value instanceof RlError) return value;
    const v = value as { code?: unknown; message?: unknown; details?: unknown } | null;
    if (v !== null && typeof v === 'object' && typeof v.code === 'string' && typeof v.message === 'string') {
      return new RlError(v.code, v.message, v.details !== null && typeof v.details === 'object' ? (v.details as Record<string, unknown>) : undefined);
    }
    return new RlError('INTERNAL', value instanceof Error ? value.message : 'Unexpected error');
  }
}
