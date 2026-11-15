export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export type LogFields = Record<string, unknown>;

/**
 * Logging contract. Implementations MUST pass fields through `redactFields`.
 * Callers must never log API keys, tokens, or document text (use ids and sizes).
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(scope: string): Logger;
}

const SENSITIVE_KEY = /(key|token|secret|password|passwd|authorization|cookie|credential|text|content|body|prompt)/i;
const MAX_STRING = 500;

/** Replace values of sensitive-looking keys and truncate long strings, recursively. */
export function redactFields(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...[${value.length} chars]` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactFields(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redactFields(v, depth + 1);
    return out;
  }
  return value;
}

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger;
  },
};

export interface MemoryLogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  fields?: unknown;
}

/** In-memory logger for tests. */
export function createMemoryLogger(scope = ''): Logger & { entries: MemoryLogEntry[] } {
  const entries: MemoryLogEntry[] = [];
  const make = (s: string): Logger => {
    const log = (level: LogLevel) => (message: string, fields?: LogFields) => {
      entries.push(fields ? { level, scope: s, message, fields: redactFields(fields) } : { level, scope: s, message });
    };
    return {
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
      child: (c) => make(s ? `${s}.${c}` : c),
    };
  };
  return Object.assign(make(scope), { entries });
}
