import type { z } from 'zod';

/** Validation outcome keyed by dotted field path ("user.orcid", "ai.models.0.id"). */
export type FieldErrors = Record<string, string>;

/**
 * Runs a core zod schema and returns the issues by field path (first issue per path wins).
 * The zod message is English and kept only for diagnostics; the UI shows the localised
 * `t(validationKey(path))` instead.
 */
export function validateWith<S extends z.ZodType>(schema: S, value: unknown): { data: z.output<S> | null; errors: FieldErrors } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { data: parsed.data, errors: {} };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.');
    if (!(key in errors)) errors[key] = issue.message;
  }
  return { data: null, errors };
}

/** i18n key for the inline error of a field path. */
export function validationKey(path: string): string {
  const last = path.split('.').filter((p) => p && !/^\d+$/.test(p)).pop();
  return last ? `validation.${last}` : 'validation.invalid';
}

/** Splits a multi-line text box into trimmed, non-empty, de-duplicated lines. */
export function splitLines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
}
