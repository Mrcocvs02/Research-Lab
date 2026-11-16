import { createTextExtractor } from '@rl/data';
import { AppError, documentIdSchema, type DocumentId, type DocumentRecord, type TextExtractor } from '@rl/core';
import type { AiProviderId } from '@rl/core';
import type { LibraryToolsHost } from '@rl/ai';
import type { LibraryRuntime } from '../library/library-runtime.js';
import { localPaths } from '../library/library-runtime.js';
import { makeTaxonomyLookup } from '../library/indexable.js';
import type { MainServices } from '../ipc/handlers/services.js';

export interface ToolsHostContext {
  s: MainServices;
  rt: LibraryRuntime;
  provider: AiProviderId;
  model: string;
  /** The user confirmed the preview of this turn (recorded in the log). */
  confirmed: boolean;
  /** One extractor per library, shared by the turns (it only reads the text cache; a miss extracts the file). */
  extractor?: () => TextExtractor;
}

/** Connects the library tools of `@rl/ai` to the active library: store, search index, text cache, log, events. */
export function createToolsHost(c: ToolsHostContext): LibraryToolsHost {
  const { s, rt } = c;
  let root: string | undefined;
  const rootPath = async () => (root ??= (await s.libraries.profile(rt.libraryId)).rootPath);
  const extractor = c.extractor ?? (() => createTextExtractor({ cacheDir: localPaths(s.localDataDir, rt.libraryId).textCacheDir }));
  const deviceId = async () => (await s.settings.get()).deviceId;

  return {
    enabledFolders: async () => (await rt.store.readConfig()).aiEnabledFolders,
    search: (q) => rt.search({ text: q.text, limit: q.limit }),
    async getDocument(id) {
      if (!documentIdSchema.safeParse(id).success) return null;
      return (await rt.store.documents.get(id as DocumentId)) ?? null;
    },
    async tagLabels(ids) {
      const lookup = makeTaxonomyLookup(await rt.store.readTaxonomy());
      return Object.fromEntries(ids.map((id) => [id, lookup.tagLabel(id) ?? id]));
    },
    async pageTexts(doc: DocumentRecord, pages) {
      try {
        const text = await extractor().extract(await rootPath(), doc.path, { hash: doc.hash, maxPages: Math.max(...pages) });
        const wanted = new Set(pages);
        return text.pages.filter((p) => wanted.has(p.page)).map((p) => ({ page: p.page, text: p.text }));
      } catch (e) {
        s.log.warn('page text unavailable for the AI tools', { error: e });
        return [];
      }
    },
    async listNotes(docId) {
      const notes = await rt.store.notes.listForDocument(docId as DocumentId);
      return notes.map((n) => ({ page: n.frontmatter.scope === 'page' ? (n.frontmatter.page ?? null) : null, body: n.body, updatedAt: n.frontmatter.updatedAt }));
    },
    async writeAiField(docId, field, value) {
      const now = new Date().toISOString();
      let before: unknown = null;
      await rt.store.documents.update(docId as DocumentId, (cur) => {
        if (!cur) throw new AppError('NOT_FOUND', 'Unknown document');
        before = cur.ai[field] ? { status: cur.ai[field]!.review.status, model: cur.ai[field]!.meta.model } : null;
        // Only `ai.<field>` changes: no user field, no note.
        return { ...cur, ai: { ...cur.ai, [field]: value }, updatedAt: now } as DocumentRecord;
      });
      await rt.store
        .appendLog({
          type: 'change',
          at: now,
          deviceId: await deviceId(),
          actor: 'ai',
          target: { kind: 'document', id: docId },
          action: 'ai.field.write',
          summary: `AI proposed ${field}`,
          before,
          after: { field, status: 'proposed', model: value.meta.model, source: value.meta.source },
        })
        .catch((e: unknown) => s.log.warn('could not log an AI field write', { error: e }));
      await rt.reindexDocuments([docId as DocumentId]).catch((e: unknown) => s.log.warn('index refresh after an AI field write failed', { error: e }));
      s.emit('library:changed', { kind: 'documents', ids: [docId] });
    },
    async logSend(e) {
      await rt.store.appendLog({
        type: 'ai-send',
        at: new Date().toISOString(),
        deviceId: await deviceId(),
        provider: c.provider,
        model: c.model,
        purpose: e.purpose,
        docIds: e.docIds,
        folders: e.folders,
        approxInputTokens: e.approxInputTokens,
        confirmed: c.confirmed,
      });
    },
  };
}
