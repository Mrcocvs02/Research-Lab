import { copyFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { AppError, appSettingsSchema, defaultAppSettings, SCHEMA_VERSION, type AppNotice, type AppSettings, type Logger } from '@rl/core';
import { atomicWriteJson, readTextFileLimited } from '@rl/core/node';

/** A settings file larger than this is not ours (it holds a handful of profiles). */
const MAX_SETTINGS_BYTES = 4 * 1024 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Per-machine settings in `<userData>/settings.json`. Serialised writes, atomic, validated.
 *
 * The file is never silently thrown away:
 *  - written by a NEWER app version: left untouched, the store is read-only for this session
 *    (`update` fails with READ_ONLY) and a `settings-read-only` notice is raised;
 *  - corrupt or invalid: kept aside as `settings.json.invalid-<ts>`, the app restarts from
 *    defaults and a `settings-reset` notice (with the reason) is raised.
 */
export class SettingsStore {
  private current: AppSettings | null = null;
  private loading: Promise<AppSettings> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readOnly = false;
  private readonly pending: AppNotice[] = [];

  constructor(
    private readonly file: string,
    private readonly log: Logger,
    /** What the system reports (`app.getLocale()`): picks the language of a first run (D-357). */
    private readonly locale?: string,
  ) {}

  static forDir(userDataDir: string, log: Logger, locale?: string): SettingsStore {
    return new SettingsStore(path.join(userDataDir, 'settings.json'), log, locale);
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

  /** Notices raised while loading and not dismissed yet. Call after `get()`. */
  notices(): AppNotice[] {
    return structuredClone(this.pending);
  }

  /** Adds a notice raised after the start (e.g. the automatic backup); the caller also emits it for a window that is listening. */
  raiseNotice(notice: AppNotice): void {
    if (!this.pending.some((n) => n.id === notice.id)) this.pending.push(notice);
  }

  dismissNotice(id: string): void {
    const i = this.pending.findIndex((n) => n.id === id);
    if (i >= 0) this.pending.splice(i, 1);
  }

  get isReadOnly(): boolean {
    return this.readOnly;
  }

  private async load(): Promise<AppSettings> {
    let raw: string;
    try {
      raw = await readTextFileLimited(this.file, MAX_SETTINGS_BYTES);
    } catch (e) {
      if (e instanceof AppError && e.code === 'NOT_FOUND') return this.writeDefaults();
      if (e instanceof AppError && e.code === 'INVALID_REQUEST') return this.reset('invalid-schema', []);
      throw e;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    } catch {
      return this.reset('invalid-json', []);
    }

    if (isObject(json) && typeof json.schemaVersion === 'number' && json.schemaVersion > SCHEMA_VERSION) {
      return this.openReadOnly(json, json.schemaVersion);
    }

    const parsed = appSettingsSchema.safeParse(json);
    if (parsed.success) return parsed.data;
    return this.reset('invalid-schema', parsed.error.issues.slice(0, 10).map((i) => i.path.join('.') || '(root)'));
  }

  private async writeDefaults(): Promise<AppSettings> {
    const defaults = defaultAppSettings(this.locale === undefined ? {} : { locale: this.locale });
    await atomicWriteJson(this.file, defaults);
    return defaults;
  }

  /** Newer file: use what we can understand, in memory only; never write it back. */
  private openReadOnly(json: Record<string, unknown>, foundVersion: number): AppSettings {
    this.readOnly = true;
    const lenient = appSettingsSchema.safeParse({ ...json, schemaVersion: SCHEMA_VERSION });
    this.log.warn('settings file is from a newer app version: opened read-only', { foundVersion, supportedVersion: SCHEMA_VERSION });
    this.pending.push({ id: 'settings-read-only', kind: 'settings-read-only', foundVersion, supportedVersion: SCHEMA_VERSION });
    return lenient.success ? lenient.data : appSettingsSchema.parse({});
  }

  /** Corrupt file: keep a copy next to it (never delete), then start again from defaults. */
  private async reset(reason: 'invalid-json' | 'invalid-schema', fields: string[]): Promise<AppSettings> {
    const stamp = Date.now();
    const backupName = `${path.basename(this.file)}.invalid-${stamp}`;
    const aside = path.join(path.dirname(this.file), backupName);
    try {
      await rename(this.file, aside);
    } catch {
      // Could not move it: copy instead, and refuse to overwrite the original if even that fails.
      await copyFile(this.file, aside).catch((e: unknown) => {
        throw new AppError('IO_ERROR', 'The settings file is invalid and could not be preserved', {}, { cause: e });
      });
    }
    this.log.warn('settings file invalid: copy kept, restarted from defaults', { reason, backupName });
    this.pending.push({ id: `settings-reset-${stamp}`, kind: 'settings-reset', reason, backupName, fields });
    return this.writeDefaults();
  }

  /** Read-modify-write; the mutator receives a copy and may mutate it or return the new settings. */
  update(mutator: (s: AppSettings) => AppSettings | void): Promise<AppSettings> {
    const run = async () => {
      const draft = await this.get();
      if (this.readOnly) throw new AppError('READ_ONLY', 'Settings were written by a newer version of the app and cannot be changed');
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
