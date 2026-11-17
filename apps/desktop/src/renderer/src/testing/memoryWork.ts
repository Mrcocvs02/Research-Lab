import { AppError } from '@rl/core';
import { emitEvent } from './mockRl';

type Handler = (payload: any) => unknown;
const now = () => '2026-11-17T10:00:00.000Z';

/**
 * In-memory main process for the phase 4 wave 2 channels: `jobs:*`, `review:*` and `inbox:*`. `ai` is the `memoryAi`
 * fake, whose `ai:preview` answers the estimates. Tests read `state.*` for what was asked and set the answers.
 */
export function memoryWork(ai: { handlers: Record<string, Handler>; state: { config: { aiEnabledFolders: string[] } } }) {
  const state = {
    // jobs
    jobs: [] as any[],
    started: [] as any[],
    estimates: [] as any[],
    skipped: 0,
    startError: null as AppError | null,
    cancelled: [] as string[],
    // review
    reviewItems: [] as any[],
    decisions: [] as any[],
    manyDecisions: [] as any[],
    tagsAccepted: 0,
    tagsProposed: 0,
    decideError: null as AppError | null,
    // inbox
    inbox: [] as any[],
    added: [] as string[][],
    confirms: [] as any[],
    dismissed: [] as string[],
    lookups: [] as string[],
    previews: [] as any[],
    proposals: [] as any[],
    chooseResult: { added: [] as any[], refused: [] as any[] },
    confirmError: null as AppError | null,
    proposeError: null as AppError | null,
    counter: 1,
  };

  const progress = (patch: Record<string, unknown>) => {
    const job = { ...state.jobs[0], ...patch };
    state.jobs = [job, ...state.jobs.slice(1)];
    emitEvent('jobs:progress', job);
  };

  const emitInbox = () => emitEvent('inbox:changed', { count: state.inbox.length });
  const makeItem = (name: string, over: Record<string, unknown> = {}) => {
    const n = state.counter++;
    return {
      id: String(n).padStart(16, '0'),
      kind: 'dropped',
      fileName: name,
      size: 2048,
      addedAt: now(),
      detected: { doi: '10.1000/test', title: 'Detected title', authors: ['A. Author'], year: 2020 },
      lookup: { state: 'found', source: 'openalex', checkedAt: now() },
      metadata: { title: 'Online title', authors: ['B. Writer'], year: 2021, venue: 'Journal', doi: '10.1000/test', arxivId: null, abstract: null, publication: 'published' },
      duplicate: null,
      proposal: { name, folder: '', tagIds: [], newTags: [], tagsFrom: 'none' },
      ...over,
    };
  };

  const decide = (p: any) => {
    if (state.decideError) {
      const e = state.decideError;
      state.decideError = null;
      throw e;
    }
    const it = state.reviewItems.find((x) => x.docId === p.docId && x.field === p.field);
    if (!it || it.status !== 'proposed') throw new AppError('CONFLICT', 'not proposed', { reason: 'not-proposed' });
    if (p.expectedRevision !== undefined && p.expectedRevision !== it.revision) throw new AppError('CONFLICT', 'stale', { reason: 'revision' });
    state.decisions.push(p);
    it.status = p.decision === 'accept' ? 'accepted' : p.decision === 'reject' ? 'rejected' : 'edited';
    if (it.field === 'tags') {
      state.tagsProposed += it.value.length;
      state.tagsAccepted += p.decision === 'reject' ? 0 : (p.keepTagIds ?? it.value).length;
    }
    return { document: { id: p.docId }, changeId: `change-${state.decisions.length}`, createdNodeIds: [] };
  };

  const handlers: Record<string, Handler> = {
    'jobs:estimate': (p) => {
      state.estimates.push(p);
      const preview = ai.handlers['ai:preview']!({ purpose: 'job', model: p.model, docIds: p.docIds }) as any;
      const skipped = Math.min(state.skipped, preview.allowed.length);
      return { preview, skipped, toSend: preview.allowed.length - skipped };
    },
    'jobs:start': (p) => {
      state.started.push(p);
      if (state.startError) {
        const e = state.startError;
        state.startError = null;
        throw e;
      }
      if (!p.confirmed) throw new AppError('CONFLICT', 'confirm', { reason: 'needs-confirmation' });
      const jobId = `job-${state.started.length}`;
      const job = { jobId, kind: 'suggest', fields: p.fields, model: p.model, state: 'running', total: p.docIds.length, done: 0, failed: 0, skipped: 0, usd: 0, createdAt: now() };
      state.jobs = [job, ...state.jobs];
      emitEvent('jobs:progress', job);
      return { jobId };
    },
    'jobs:cancel': (p) => {
      state.cancelled.push(p.jobId);
      return { cancelled: true };
    },
    'jobs:list': () => ({ items: structuredClone(state.jobs) }),

    'review:list': (p) => {
      const rows = state.reviewItems.filter((i) => i.status === (p.status ?? 'proposed') && (!p.fields || p.fields.includes(i.field)));
      return { items: structuredClone(rows.slice(p.offset ?? 0, (p.offset ?? 0) + (p.limit ?? 50))), total: rows.length };
    },
    'review:decide': decide,
    'review:decideMany': (p) => {
      state.manyDecisions.push(p);
      let changed = 0;
      const failed: any[] = [];
      for (const { docId, field } of p.items) {
        const it = state.reviewItems.find((x) => x.docId === docId && x.field === field);
        if (it && it.status === 'proposed') {
          it.status = p.decision === 'accept' ? 'accepted' : 'rejected';
          changed++;
        } else failed.push({ docId, field, code: 'CONFLICT' });
      }
      return { changeId: 'change-many', changed, failed };
    },
    'review:stats': () => {
      const pending: Record<string, number> = {};
      for (const i of state.reviewItems) if (i.status === 'proposed') pending[i.field] = (pending[i.field] ?? 0) + 1;
      return {
        pending,
        tags: { proposed: state.tagsProposed, accepted: state.tagsAccepted, rate: state.tagsProposed ? state.tagsAccepted / state.tagsProposed : null },
        newTags: { proposed: 0, accepted: 0 },
      };
    },

    'inbox:list': () => ({ items: structuredClone(state.inbox) }),
    'inbox:add': (p) => {
      state.added.push(p.paths);
      const added: any[] = [];
      const refused: any[] = [];
      for (const path of p.paths as string[]) {
        const name = path.split('/').pop()!;
        if (!name.toLowerCase().endsWith('.pdf')) refused.push({ name, reason: 'not-pdf' });
        else if (state.inbox.some((i) => i.fileName === name)) refused.push({ name, reason: 'already-queued' });
        else {
          const item = makeItem(name);
          state.inbox.push(item);
          added.push(item);
        }
      }
      if (added.length > 0) emitInbox();
      return { added, refused };
    },
    'inbox:choose': () => {
      state.inbox.push(...state.chooseResult.added);
      if (state.chooseResult.added.length > 0) emitInbox();
      return state.chooseResult;
    },
    'inbox:lookup': (p) => {
      state.lookups.push(p.id);
      const it = state.inbox.find((i) => i.id === p.id);
      if (!it) throw new AppError('NOT_FOUND', 'item');
      it.lookup = { state: 'found', source: 'openalex', checkedAt: now() };
      return structuredClone(it);
    },
    'inbox:previewTags': (p) => {
      state.previews.push(p);
      const it = state.inbox.find((i) => i.id === p.id);
      const dir = p.folder ?? (it?.path?.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/')) : '');
      const enabled = ai.state.config.aiEnabledFolders.some((f) => f === '' || dir === f || dir.startsWith(`${f}/`));
      return { model: p.model, allowed: enabled ? [p.id] : [], refused: enabled ? [] : [{ docId: p.id, reason: 'folder-not-enabled' }], folders: enabled ? [dir] : [], approxInputTokens: 800, estimatedUsd: 0.002, needsConfirmation: true, overCap: false };
    },
    'inbox:proposeTags': (p) => {
      state.proposals.push(p);
      if (state.proposeError) {
        const e = state.proposeError;
        state.proposeError = null;
        throw e;
      }
      const it = state.inbox.find((i) => i.id === p.id);
      if (!it) throw new AppError('NOT_FOUND', 'item');
      it.proposal = { ...it.proposal, tagIds: ['tag-a'], newTags: [{ label: 'Brand new', parentId: null, aliases: [], reason: 'nothing fits' }], tagsFrom: 'ai' };
      return structuredClone(it);
    },
    'inbox:confirm': (p) => {
      state.confirms.push(p);
      if (state.confirmError) {
        const e = state.confirmError;
        state.confirmError = null;
        throw e;
      }
      const it = state.inbox.find((i) => i.id === p.id);
      if (!it) throw new AppError('NOT_FOUND', 'item');
      if (it.duplicate?.kind === 'same-file') throw new AppError('CONFLICT', 'dup', { reason: 'duplicate' });
      state.inbox = state.inbox.filter((i) => i.id !== p.id);
      emitInbox();
      return { docId: p.id, path: `${p.folder ? `${p.folder}/` : ''}${p.name ?? it.fileName}`, changeId: 'change-inbox' };
    },
    'inbox:dismiss': (p) => {
      state.dismissed.push(p.id);
      state.inbox = state.inbox.filter((i) => i.id !== p.id);
      emitInbox();
      return { ok: true };
    },
  };
  return { state, handlers, makeItem, progress, emitInbox };
}
