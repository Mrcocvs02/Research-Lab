import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AI_LIMITS, chatTurnSchema, isoDateSchema, itemIdSchema } from '@rl/core';
import { atomicWriteFile } from '@rl/core/node';

export type ChatTurn = z.infer<typeof chatTurnSchema>;

const MAX_CONVERSATION_BYTES = 8 * 1024 * 1024;

const conversationFileSchema = z.object({
  version: z.literal(1),
  id: itemIdSchema,
  title: z.string().max(AI_LIMITS.title),
  /** Files written before the advanced search have no mode: they are chats. */
  mode: z.enum(['chat', 'search']).default('chat'),
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
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(localDataDir: string, libraryId: string) {
    this.dir = path.join(localDataDir, 'chat', itemIdSchema.parse(libraryId));
  }

  private file(id: string): string {
    return path.join(this.dir, `${itemIdSchema.parse(id)}.json`);
  }

  async get(id: string): Promise<Conversation | null> {
    const file = this.file(id);
    try {
      const st = await stat(file);
      if (!st.isFile() || st.size > MAX_CONVERSATION_BYTES) return null;
      const parsed = conversationFileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
      return parsed.success && parsed.data.id === id ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Read-modify-write of one conversation; `fn` gets null when it does not exist yet. */
  async update(id: string, fn: (current: Conversation | null) => Conversation): Promise<Conversation> {
    const run = async () => {
      const next = conversationFileSchema.parse(fn(await this.get(id)));
      await mkdir(this.dir, { recursive: true });
      await atomicWriteFile(this.file(id), `${JSON.stringify(next)}\n`);
      return next;
    };
    const prev = this.tails.get(id) ?? Promise.resolve();
    const next = prev.then(run, run);
    const tail = next.catch(() => {});
    this.tails.set(id, tail);
    void tail.then(() => {
      if (this.tails.get(id) === tail) this.tails.delete(id);
    });
    return next;
  }

  async list(limit: number): Promise<ConversationSummary[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
    } catch {
      return [];
    }
    const items: ConversationSummary[] = [];
    for (const name of names) {
      const c = await this.get(name.slice(0, -5)).catch(() => null);
      if (c) items.push({ id: c.id, title: c.title, mode: c.mode, updatedAt: c.updatedAt, turns: c.turns.length });
    }
    return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)).slice(0, limit);
  }

  async delete(id: string): Promise<boolean> {
    const file = this.file(id);
    const existed = await stat(file).then((s) => s.isFile(), () => false);
    if (existed) await rm(file, { force: true });
    return existed;
  }
}
