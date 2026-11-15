import { rename } from 'node:fs/promises';
import path from 'node:path';
import { AppError, appSettingsSchema, type AppSettings, type Logger } from '@rl/core';
import { atomicWriteJson, readJsonFile } from '@rl/core/node';

/** Per-machine settings in `<userData>/settings.json`. Serialised writes, atomic, validated. */
export class SettingsStore {
  private current: AppSettings | null = null;
  private loading: Promise<AppSettings> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly log: Logger,
  ) {}

  static forDir(userDataDir: string, log: Logger): SettingsStore {
    return new SettingsStore(path.join(userDataDir, 'settings.json'), log);
  }

  async get(): Promise<AppSettings> {
    if (!this.current) {
      // Memoised so concurrent first calls load (and create the defaults) exactly once.
      this.loading ??= this.load().finally(() => {
        this.loading = null;
      });
      this.current ??= await this.loading;
    }
    return structuredClone(this.current);
  }

  private async load(): Promise<AppSettings> {
    try {
      return await readJsonFile(this.file, appSettingsSchema);
    } catch (e) {
      if (e instanceof AppError && e.code === 'SCHEMA_INVALID') {
        const aside = `${this.file}.invalid-${Date.now()}`;
        await rename(this.file, aside).catch(() => {});
        this.log.warn('settings file invalid, moved aside and reset to defaults');
      } else if (!(e instanceof AppError && e.code === 'NOT_FOUND')) {
        throw e;
      }
      const defaults = appSettingsSchema.parse({});
      await atomicWriteJson(this.file, defaults);
      return defaults;
    }
  }

  /** Read-modify-write; the mutator receives a copy and may mutate it or return the new settings. */
  update(mutator: (s: AppSettings) => AppSettings | void): Promise<AppSettings> {
    const run = async () => {
      const draft = await this.get();
      const next = appSettingsSchema.parse(mutator(draft) ?? draft);
      await atomicWriteJson(this.file, next);
      this.current = next;
      return structuredClone(next);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}
