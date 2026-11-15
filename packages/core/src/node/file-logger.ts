import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { LOG_LEVELS, redactFields, type LogFields, type Logger, type LogLevel } from '../log.js';

export interface FileLoggerOptions {
  /** Folder for log files (local app data, not a synced folder). */
  dir: string;
  /** Base file name without extension. Default "app". */
  name?: string;
  level?: LogLevel;
  /** Rotate when the file exceeds this size. Default 2 MiB. */
  maxBytes?: number;
  /** Rotated files kept. Default 3. */
  maxFiles?: number;
  /** Mirror to console (dev). */
  console?: boolean;
}

/** JSON-lines logger. Fields are always redacted (keys, tokens, text). Never throws. */
export function createFileLogger(options: FileLoggerOptions): Logger {
  const { dir, name = 'app', level = 'info', maxBytes = 2 * 1024 * 1024, maxFiles = 3 } = options;
  const min = LOG_LEVELS.indexOf(level);
  const file = path.join(dir, `${name}.log`);
  let size = 0;
  try {
    mkdirSync(dir, { recursive: true });
    size = statSync(file).size;
  } catch {
    /* new file */
  }

  const rotate = () => {
    try {
      rmSync(path.join(dir, `${name}.${maxFiles}.log`), { force: true });
      for (let i = maxFiles - 1; i >= 1; i--) {
        try {
          renameSync(path.join(dir, `${name}.${i}.log`), path.join(dir, `${name}.${i + 1}.log`));
        } catch {
          /* missing */
        }
      }
      renameSync(file, path.join(dir, `${name}.1.log`));
      size = 0;
    } catch {
      /* best effort */
    }
  };

  const make = (scope: string): Logger => {
    const write = (lvl: LogLevel) => (message: string, fields?: LogFields) => {
      if (LOG_LEVELS.indexOf(lvl) < min) return;
      try {
        const line = `${JSON.stringify({ t: new Date().toISOString(), level: lvl, scope, msg: message, ...(fields ? { fields: redactFields(fields) } : {}) })}\n`;
        if (size + line.length > maxBytes) rotate();
        appendFileSync(file, line);
        size += line.length;
        if (options.console) (lvl === 'error' ? console.error : console.log)(line.trimEnd());
      } catch {
        /* logging must never break the app */
      }
    };
    return {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
      child: (c) => make(scope ? `${scope}.${c}` : c),
    };
  };
  return make('');
}
