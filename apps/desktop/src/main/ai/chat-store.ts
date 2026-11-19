import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AI_LIMITS, AppError, chatTurnSchema, isoDateSchema, itemIdSchema } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';
import { KeyedQueue } from '../keyed-queue.js';

export type ChatTurn = z.infer<typeof chatTurnSchema>;

const MAX_CONVERSATION_BYTES = 8 * 1024 * 1024;
const INDEX_FILE = '.index.json';
const summarySchema = z.object({ id: itemIdSchema, title: z.string(), mode: z.enum(['chat', 'search']), updatedAt: isoDateSchema, turns: z.number().int().nonnegative() });
/** `summary` is null for a file that could not be read (kept so it is not parsed again until it changes). */
const indexSchema = z.record(z.string(), z.object({ size: z.number(), mtimeMs: z.number(), summary: summarySchema.nullable() }));
type IndexEntries = z.infer<typeof indexSchema>;

const conversationFileSchema = z.object({
  version: z.literal(1),
  id: itemIdSchema,
  title: z.string().max(AI_LIMITS.title),
  /** Files written before the advanced search have no mode: they are chats. */
  mode: z.enum(['chat', 'search']).default('chat'),
  /** The user confirmed the sends of this conversation (D-227). Files written before: not confirmed. */
  confirmed: z.boolean().default(false),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  turns: z.array(chatTurnSchema).max(10_000),
});
export type Conversation = z.output<typeof conversationFileSchema>;

export interface ConversationSummary {
  id: string;
  title: string;
  mode: 'chat' | 'search';
  updatedAt: string;
  turns: number;
}

/** A title from the first message: one line, at most 60 characters. */
export function titleFrom(text: string): string {
  const t = [...text.replace(/\s+/g, ' ').trim()].slice(0, 60).join('');
  return t === '' ? 'Chat' : t;
}

/**
 * Local chat history of one library: `<localData>/chat/<libraryId>/<conversationId>.json`. Private to this machine (not in
 * the synced data folder). Writes are atomic; ids are validated item ids, so no id can leave the folder.
 */
export class ChatStore {
  private readonly dir: string;
  /** Writes of one conversation run one after the other. */
  private readonly queue = new KeyedQueue();

  constructor(localDataDir: string, libraryId: string) {
    this.dir = path.join(localDataDir, 'chat', itemIdSchema.parse(libraryId));
  }

  private file(id: string): string {
    return path.join(this.dir, `${itemIdSchema.parse(id)}.json`);
  }

  /** Reads one file: absent, readable, or present but unusable (too big, invalid, another id). */
  private async read(id: string): Promise<{ state: 'missing' } | { state: 'bad' } | { state: 'ok'; conversation: Conversation }> {
    const file = this.file(id);
    let st;
    try {
      st = await stat(file);
    } catch {
      return { state: 'missing' };
    }
    try {
      if (!st.isFile() || st.size > MAX_CONVERSATION_BYTES) return { state: 'bad' };
      const parsed = conversationFileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
      return parsed.success && parsed.data.id === id ? { state: 'ok', conversation: parsed.data } : { state: 'bad' };
    } catch {
      return { state: 'bad' };
    }
  }

  async get(id: string): Promise<Conversation | null> {
    const r = await this.read(id);
    return r.state === 'ok' ? r.conversation : null;
  }

  /**
   * Read-modify-write of one conversation; `fn` gets null when it does not exist yet. A file that exists but cannot be
   * loaded is never overwritten: it is copied to `<id>.json.bad` and the update is refused.
   */
  async update(id: string, fn: (current: Conversation | null) => Conversation): Promise<Conversation> {
    const run = async () => {
      const cur = await this.read(id);
      if (cur.state === 'bad') {
        await copyFile(this.file(id), `${this.file(id)}.bad`).catch(() => {});
        throw new AppError('CONFLICT', 'The conversation file cannot be read: it was kept as it is', { reason: 'conversation-unreadable' });
      }
      const next = conversationFileSchema.parse(fn(cur.state === 'ok' ? cur.conversation : null));
      await mkdir(this.dir, { recursive: true });
      await atomicWriteFile(this.file(id), `${JSON.stringify(next)}
`);
      return next;
    };
    return this.queue.run(id, run);
  }

  /**
   * The newest conversations. A small index (`.index.json`, next to the files) keeps each summary with the size and
   * modification time of its file: only files that changed since are parsed again, so a long history costs a `stat` per file.
   */
  async list(limit: number): Promise<ConversationSummary[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
    } catch {
      return [];
    }
    const old = await this.readIndex();
    const entries: IndexEntries = {};
    let changed = names.length !== Object.keys(old).length;
    for (const name of names) {
      const id = name.slice(0, -5);
      const st = await stat(path.join(this.dir, name)).catch(() => null);
      if (!st || !st.isFile()) {
        changed = true;
        continue;
      }
      const hit = old[id];
      if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
        entries[id] = hit;
        continue;
      }
      changed = true;
      const r = await this.read(id).catch(() => ({ state: 'bad' as const }));
      entries[id] =
        r.state === 'ok'
          ? { size: st.size, mtimeMs: st.mtimeMs, summary: { id: r.conversation.id, title: r.conversation.title, mode: r.conversation.mode, updatedAt: r.conversation.updatedAt, turns: r.conversation.turns.length } }
          : { size: st.size, mtimeMs: st.mtimeMs, summary: null };
    }
    if (changed) await atomicWriteFile(path.join(this.dir, INDEX_FILE), `${JSON.stringify(entries)}
`).catch(() => {});
    const items = Object.values(entries).flatMap((e) => (e.summary ? [e.summary] : []));
    return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)).slice(0, limit);
  }

  private async readIndex(): Promise<IndexEntries> {
    try {
      const parsed = indexSchema.safeParse(JSON.parse(await readFile(path.join(this.dir, INDEX_FILE), 'utf8')));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  async delete(id: string): Promise<boolean> {
    const file = this.file(id);
    const existed = await stat(file).then((s) => s.isFile(), () => false);
    if (existed) await rm(file, { force: true });
    return existed;
  }
}
