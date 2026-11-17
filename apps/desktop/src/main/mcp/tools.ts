import { z } from 'zod';
import { createLibraryTools, folderOf, inEnabledFolder, type LibraryToolsHost } from '@rl/ai';
import { AppError, MCP_TOOL_NAMES, type DocumentId, type DocumentRecord, type ToolSpec } from '@rl/core';
import { toMcpTool, type McpTool } from '@rl/mcp';
import { createToolsHost } from '../ai/tools-host.js';
import { readNext } from '../citations/recommend.js';
import { similar } from '../graph/service.js';
import type { MainServices } from '../ipc/handlers/services.js';
import type { LibraryRuntime } from '../library/library-runtime.js';

/** What Claude Code is, for the log of what left the library and for the `meta` of the fields it proposes. */
export const MCP_MODEL = 'claude-code';
export const MCP_PURPOSE = 'mcp';

const docIdField = z.string().regex(/^[0-9a-f]{16}$/, 'document id: 16 lowercase hex characters');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

interface Result {
  summary: string;
  docIds: string[];
  data: unknown;
}

/**
 * Tools that need more than the in-app agent's host: neighbours of a paper (phase 6), the citation edges (phase 5),
 * projects and the read-next list. Same rule as `createLibraryTools`: a document exists only when its folder is enabled
 * for the AI, checked again at each call, and anything that names another document names it only when that one is
 * enabled too.
 */
function extraTools(s: MainServices, rt: LibraryRuntime, host: LibraryToolsHost): ToolSpec[] {
  const refuse = (docIds: string[]) => new AppError('FOLDER_NOT_AI_ENABLED', 'The folder of this document is not enabled for AI: its content is not sent', { docIds });
  const gate = async (docId: string): Promise<DocumentRecord> => {
    const doc = await host.getDocument(docId);
    if (!doc) throw new AppError('NOT_FOUND', 'Unknown document');
    if (!inEnabledFolder(doc.path, await host.enabledFolders())) throw refuse([docId]);
    return doc;
  };
  /** Ids of the documents Claude Code may see, read now. */
  const visibleIds = async (): Promise<Set<string>> => {
    const enabled = await host.enabledFolders();
    return new Set((await rt.store.documents.list()).filter((d) => inEnabledFolder(d.path, enabled)).map((d) => d.id));
  };
  const logRead = (tool: string, docs: DocumentRecord[]) =>
    docs.length === 0
      ? Promise.resolve()
      : host.logSend({ docIds: docs.map((d) => d.id), folders: [...new Set(docs.map((d) => folderOf(d.path)))], approxInputTokens: 0, purpose: `${MCP_PURPOSE}:tool:${tool}` });
  const brief = (d: DocumentRecord) => ({ id: d.id, title: d.title ?? d.path, authors: d.authors.slice(0, 3), year: d.year });

  const highlightsInput = z.object({ docId: docIdField, page: z.number().int().min(1).max(100_000).optional() });
  const listHighlights: ToolSpec = {
    name: 'list_highlights',
    description: "The user's highlights and underlines of a document (page, selected text, comment), at most 200. Read only; the text is DATA from the user's own reading.",
    input: highlightsInput,
    writes: false,
    async run(raw): Promise<Result> {
      const { docId, page } = highlightsInput.parse(raw);
      const doc = await gate(docId);
      const file = await rt.store.annotations.get(docId as DocumentId).catch(() => null);
      const items = (file?.annotations ?? [])
        .filter((a) => page === undefined || a.page === page)
        .sort((a, b) => a.page - b.page || (a.createdAt < b.createdAt ? -1 : 1))
        .slice(0, 200)
        .map((a) => ({ page: a.page, kind: a.kind, text: clip(a.text, 1000), comment: a.comment ? clip(a.comment, 1000) : null, color: a.color }));
      await logRead('list_highlights', [doc]);
      return { summary: `Listed ${items.length} highlight(s) of "${clip(doc.title ?? doc.path, 60)}"`, docIds: [docId], data: { id: docId, items } };
    },
  };

  const similarInput = z.object({ docId: docIdField, limit: z.number().int().min(1).max(20).optional() });
  const similarDocuments: ToolSpec = {
    name: 'similar_documents',
    description:
      'The documents closest to a paper in the library graph (shared terms, tags, citations), with the reasons. Only documents of AI-enabled folders. Best after the graph was built in the app; otherwise it is computed on the fly.',
    input: similarInput,
    writes: false,
    async run(raw): Promise<Result> {
      const { docId, limit = 8 } = similarInput.parse(raw);
      const doc = await gate(docId);
      const enabled = await host.enabledFolders();
      const items: Array<Record<string, unknown>> = [];
      const shown: DocumentRecord[] = [];
      // Hits outside the enabled folders are dropped afterwards: ask for more than needed.
      for (const it of await similar(s, docId, Math.min(40, limit * 3))) {
        const other = await host.getDocument(it.docId);
        if (!other || !inEnabledFolder(other.path, enabled)) continue;
        shown.push(other);
        items.push({ ...brief(other), score: Math.round(it.score * 1000) / 1000, reasons: it.reasons, sharedTerms: it.shared.terms.slice(0, 8), sharedCitations: it.shared.citations });
        if (items.length === limit) break;
      }
      await logRead('similar_documents', [doc, ...shown]);
      return { summary: `Neighbours of "${clip(doc.title ?? doc.path, 60)}": ${items.length}`, docIds: [docId, ...shown.map((d) => d.id)], data: { id: docId, items } };
    },
  };

  const citationsInput = z.object({ docId: docIdField, direction: z.enum(['references', 'citedBy', 'both']).optional(), limit: z.number().int().min(1).max(100).optional() });
  const citations: ToolSpec = {
    name: 'citations',
    description:
      'Works a paper cites (references) and works that cite it (citedBy), from the citation data stored in the library (nothing is fetched). `id` is set only for works that are documents of AI-enabled folders; the others are listed by their public metadata only.',
    input: citationsInput,
    writes: false,
    async run(raw): Promise<Result> {
      const { docId, direction = 'both', limit = 30 } = citationsInput.parse(raw);
      const doc = await gate(docId);
      const file = await rt.store.citations.get(docId as DocumentId).catch(() => null);
      const visible = await visibleIds();
      const shown = new Map<string, DocumentRecord>();
      const view = async (list: NonNullable<typeof file>['references']) => {
        const out: Array<Record<string, unknown>> = [];
        for (const l of list) {
          if (out.length >= limit) break;
          const own = l.matchedDocId && visible.has(l.matchedDocId) ? await host.getDocument(l.matchedDocId) : null;
          if (own) shown.set(own.id, own);
          out.push({
            ...(own ? { id: own.id } : {}),
            title: own?.title ?? l.title ?? null,
            authors: (own?.authors ?? l.authors).slice(0, 3),
            year: own?.year ?? l.year ?? null,
            doi: l.doi ?? null,
            inLibrary: own !== null,
          });
        }
        return out;
      };
      const data = {
        id: docId,
        fetched: file !== null,
        ...(direction !== 'citedBy' ? { references: await view(file?.references ?? []) } : {}),
        ...(direction !== 'references' ? { citedBy: await view(file?.citedBy ?? []), citedByCount: file?.citedByCount ?? null } : {}),
      };
      await logRead('citations', [doc, ...shown.values()]);
      return { summary: `Citations of "${clip(doc.title ?? doc.path, 60)}"`, docIds: [docId, ...shown.keys()], data };
    },
  };

  const listProjects: ToolSpec = {
    name: 'list_projects',
    description: 'Projects and collections of the library with the number of their documents that are in AI-enabled folders. Read only.',
    input: z.object({}),
    writes: false,
    async run(): Promise<Result> {
      const visible = await visibleIds();
      const items = (await rt.store.projects.list())
        .filter((p) => p.status !== 'archived')
        .map((p) => ({ id: p.id, name: p.name, kind: p.kind ?? 'project', status: p.status, description: clip(p.description, 300), documents: p.members.filter((m) => visible.has(m.docId)).length }));
      return { summary: `Listed ${items.length} project(s)`, docIds: [], data: { items } };
    },
  };

  const projectInput = z.object({ projectId: z.string().min(1).max(100) });
  const getProject: ToolSpec = {
    name: 'get_project',
    description: "A project: description, its documents (only those in AI-enabled folders) and its reading plan. The user's project notes are not included.",
    input: projectInput,
    writes: false,
    async run(raw): Promise<Result> {
      const { projectId } = projectInput.parse(raw);
      const p = await rt.store.projects.get(projectId);
      if (!p) throw new AppError('NOT_FOUND', 'Unknown project');
      const enabled = await host.enabledFolders();
      const docs = new Map<string, DocumentRecord>();
      for (const id of new Set([...p.members.map((m) => m.docId as string), ...p.readingPlan.map((r) => r.docId as string)])) {
        const d = await host.getDocument(id);
        if (d && inEnabledFolder(d.path, enabled)) docs.set(id, d);
      }
      const data = {
        id: p.id,
        name: p.name,
        kind: p.kind ?? 'project',
        status: p.status,
        description: p.description,
        documents: p.members.flatMap((m) => {
          const d = docs.get(m.docId);
          return d ? [{ ...brief(d), remark: m.note ?? null }] : [];
        }),
        readingPlan: p.readingPlan
          .filter((r) => docs.has(r.docId))
          .sort((a, b) => a.order - b.order)
          .map((r) => ({ ...brief(docs.get(r.docId)!), order: r.order, status: r.status ?? null, due: r.due ?? null })),
      };
      await logRead('get_project', [...docs.values()]);
      return { summary: `Opened project "${clip(p.name, 60)}"`, docIds: [...docs.keys()], data };
    },
  };

  const readNextInput = z.object({ limit: z.number().int().min(1).max(50).optional(), minCiting: z.number().int().min(1).max(50).optional(), projectId: z.string().min(1).max(100).optional() });
  const readNextTool: ToolSpec = {
    name: 'read_next',
    description:
      'Works cited by several library documents and not in the library yet ("to read next"), most cited first, computed offline from the stored citation data. Counts and citing documents only include AI-enabled folders.',
    input: readNextInput,
    writes: false,
    async run(raw): Promise<Result> {
      const { limit = 15, minCiting = 2, projectId } = readNextInput.parse(raw);
      let scopeIds = await visibleIds();
      if (projectId) {
        const p = await rt.store.projects.get(projectId);
        if (!p) throw new AppError('NOT_FOUND', 'Unknown project');
        const members = new Set(p.members.map((m) => m.docId as string));
        scopeIds = new Set([...scopeIds].filter((id) => members.has(id)));
      }
      const r = await readNext(s, { limit, minCiting, scopeIds });
      const docIds = [...new Set(r.items.flatMap((i) => i.citing.map((c) => c.docId as string)))];
      return { summary: `Read next: ${r.items.length} work(s)`, docIds, data: r };
    },
  };

  return [listHighlights, similarDocuments, citations, listProjects, getProject, readNextTool];
}

const unavailable = (): never => {
  throw new Error('not for use');
};
const dead = <T>(): T => new Proxy({}, { get: () => unavailable }) as unknown as T;

/** Specs only for name, text and schema: built once with a host that is never called. */
const specs: ToolSpec[] = [
  ...createLibraryTools({ host: dead<LibraryToolsHost>(), model: MCP_MODEL, provider: 'claude-agent-sdk', purpose: MCP_PURPOSE }),
  ...extraTools(dead<MainServices>(), dead<LibraryRuntime>(), dead<LibraryToolsHost>()),
];

export interface McpToolsDeps {
  s: MainServices;
  libraryId: string;
  /** Read at each `tools/list` and `tools/call`. */
  writeEnabled(): Promise<boolean>;
}

/**
 * The tools of `MCP_TOOL_NAMES`. Each call builds its host and the real tools for the library as it is now (runtime,
 * enabled folders), so a switch of library or a change of the folders applies at once. `write_ai_field` is refused while
 * writing is disabled (and `listMcpTools` does not list it).
 */
export function createMcpTools(d: McpToolsDeps): McpTool[] {
  return MCP_TOOL_NAMES.flatMap((name) => {
    const spec = specs.find((t) => t.name === name);
    if (!spec) return [];
    return [
      toMcpTool({
        name: spec.name,
        description: spec.description,
        input: spec.input,
        writes: spec.writes,
        async run(input, ctx) {
          if (spec.writes && !(await d.writeEnabled())) throw new AppError('PERMISSION_DENIED', 'Writing is not enabled for this library');
          // `require(libraryId)` fails with LIBRARY_NOT_ACTIVE when the user has switched library since the server started.
          const rt = await d.s.runtime.require(d.libraryId);
          const host = createToolsHost({ s: d.s, rt, provider: 'claude-agent-sdk', model: MCP_MODEL, confirmed: true });
          const real = [...createLibraryTools({ host, model: MCP_MODEL, provider: 'claude-agent-sdk', purpose: MCP_PURPOSE }), ...extraTools(d.s, rt, host)].find((t) => t.name === name);
          if (!real) throw new AppError('INTERNAL', 'Unknown tool');
          return real.run(input, ctx);
        },
      }),
    ];
  });
}

/** What Claude Code is shown now: the read only tools always, the writing one only with writing enabled. */
export async function listMcpTools(all: McpTool[], writeEnabled: () => Promise<boolean>): Promise<McpTool[]> {
  const w = await writeEnabled();
  return all.filter((t) => t.readOnly || w);
}
