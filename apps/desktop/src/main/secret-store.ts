import path from 'node:path';
import { z } from 'zod';
import { AppError, schemaVersionSchema, type SecretScope, type SecretStore } from '@rl/core';
import { atomicWriteJson, readJsonFile } from '@rl/core/node';

/** The three functions of Electron's `safeStorage` we need (injectable for tests). */
export interface Cipher {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

const fileSchema = z.object({
  schemaVersion: schemaVersionSchema,
  /** key -> base64 of the OS-encrypted value. */
  entries: z.record(z.string(), z.string()).default({}),
});

const keyOf = (scope: SecretScope, name: string) => (scope.kind === 'app' ? `app/${name}` : `library:${scope.libraryId}/${name}`);

/** Secrets encrypted with the OS (DPAPI via safeStorage), stored in userData (never in a library folder). */
export class FileSecretStore implements SecretStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly userDataDir: string,
    private readonly cipher: Cipher,
  ) {}

  private get file() {
    return path.join(this.userDataDir, 'secrets.json');
  }

  private async load() {
    return readJsonFile(this.file, fileSchema).catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'NOT_FOUND') return fileSchema.parse({});
      throw e;
    });
  }

  private requireCipher() {
    if (!this.cipher.isAvailable()) throw new AppError('SECRET_UNAVAILABLE', 'Secure storage is not available on this system');
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.queue.then(fn, fn);
    this.queue = r.catch(() => {});
    return r;
  }

  set(scope: SecretScope, name: string, value: string): Promise<void> {
    this.requireCipher();
    return this.serial(async () => {
      const data = await this.load();
      data.entries[keyOf(scope, name)] = this.cipher.encrypt(value).toString('base64');
      await atomicWriteJson(this.file, data);
    });
  }

  async get(scope: SecretScope, name: string): Promise<string | null> {
    this.requireCipher();
    const enc = (await this.load()).entries[keyOf(scope, name)];
    return enc === undefined ? null : this.cipher.decrypt(Buffer.from(enc, 'base64'));
  }

  async has(scope: SecretScope, name: string): Promise<boolean> {
    return keyOf(scope, name) in (await this.load()).entries;
  }

  delete(scope: SecretScope, name: string): Promise<void> {
    return this.serial(async () => {
      const data = await this.load();
      delete data.entries[keyOf(scope, name)];
      await atomicWriteJson(this.file, data);
    });
  }
}
