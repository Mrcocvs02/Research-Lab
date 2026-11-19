import { randomUUID } from 'node:crypto';
import { aiVisible, folderOf } from '@rl/ai';
import {
  TAXONOMY_LIMITS,
  clip,
  cleanTaxonomyProposal,
  existingTaxonomyBlock,
  taxonomyPrompt,
  taxonomySchema,
  taxonomySystem,
  type CandidateNode,
  type LibraryDigestItem,
  type TaxonomyProposalNode,
  type TaxonomyRaw,
} from '@rl/ai/analysis';
import type { OrganizerStore } from '@rl/data';
import { AppError, itemIdSchema, type DocumentRecord, type ReasoningLevel, type TaxonomyFile, type TaxonomyNode } from '@rl/core';
import type { MainServices } from '../ipc/handlers/services.js';
import { trackAbort } from '../ai/abort-registry.js';
import { availability, computePreview, loadCtx, monthUsage } from '../ai/service.js';
import { assertTokenCap } from '../ai/token-cap.js';
import { monthOf } from '../ai/usage.js';
import { callStructured, strongModel, type Runner } from './call.js';
import { readNote } from './note-store.js';

/** Library documents per call and calls per run, at most (a library of thousands is read in several calls, the taxonomy growing between them). */
const BATCH_CALLS_MAX = 12;
const GIST_CHARS = 240;

const slug = (label: string) =>
  label
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/** A free id for a label (`quantum-circuits`, then `-2`, ...), valid as an item id. */
function freshId(label: string, taken: Set<string>): string {
  const base = slug(label);
  for (let i = 1; i < 1000; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    if (base && itemIdSchema.safeParse(id).success && !taken.has(id)) return id;
  }
  return `n-${randomUUID().slice(0, 8)}`;
}

/** Adds the proposed nodes to the taxonomy as CANDIDATES of origin `ai` (nothing active until the user accepts them). Returns the count. */
export function addCandidates(cur: TaxonomyFile, proposal: readonly TaxonomyProposalNode[], now: string): { taxonomy: TaxonomyFile; added: number } {
  const taken = new Set(cur.nodes.map((n) => n.id));
  const ids: string[] = [];
  const nodes: TaxonomyNode[] = [];
  for (const p of proposal) {
    const parent = p.parent === null ? null : 'existing' in p.parent ? p.parent.existing : ids[p.parent.index];
    if (p.parent !== null && !parent) continue;
    const id = freshId(p.label, taken);
    taken.add(id);
    ids.push(id);
    nodes.push({
      id,
      label: p.label,
      parents: parent ? [parent] : [],
      aliases: p.aliases,
      implies: [],
      status: 'candidate',
      origin: 'ai',
      level: p.level,
      ...(p.definition ? { definition: p.definition } : {}),
      createdAt: now,
    });
  }
  return { taxonomy: { ...cur, nodes: [...cur.nodes, ...nodes] }, added: nodes.length };
}

/** What the model sees of each allowed document: title (never the path), accepted or proposed keywords, the start of its note or description. */
async function digest(rt: Awaited<ReturnType<typeof loadCtx>>['rt'], docs: readonly DocumentRecord[]): Promise<LibraryDigestItem[]> {
  const out: LibraryDigestItem[] = [];
  for (const d of docs) {
    const note = await readNote(rt.store.dataDir, d.id);
    const gist = note ? clip(note.replace(/^#.*$/gm, ' ').replace(/\s+/g, ' ').trim(), GIST_CHARS) : (d.ai.description?.value ?? d.userDescription ?? undefined);
    out.push({ title: d.title ?? 'Untitled', keywords: d.ai.keywords?.value ?? [], gist: gist ? clip(String(gist), GIST_CHARS) : undefined });
  }
  return out;
}

const nodeView = (n: TaxonomyNode): CandidateNode => ({ id: n.id, label: n.label, aliases: n.aliases, definition: n.definition, parents: n.parents, implies: n.implies });

/**
 * Builds or extends the domain taxonomy from the library with the stronger model (D-446 a). Only AI-enabled folders contribute; the
 * run is previewed (needs the user's confirmation as any send), capped like every send, logged, and abortable. New nodes are written
 * as candidates in one change group (undoable), for one review in the taxonomy manager.
 */
export async function runTaxonomyJob(s: MainServices, req: { mode: 'build' | 'extend'; model: string; reasoning: ReasoningLevel; confirmed: boolean }): Promise<{ added: number; calls: number }> {
  const ctx = await loadCtx(s);
  const { rt, cfg, provider } = ctx;
  if (!cfg.ai.models.some((m) => m.id === req.model)) throw new AppError('INVALID_REQUEST', 'Unknown model');
  const cap = cfg.ai.usageCap.monthlyUsd;
  const monthUsd = (await monthUsage(rt, monthOf(new Date()))).usd;
  if (cap !== null && monthUsd >= cap) throw new AppError('AI_BUDGET_EXCEEDED', 'The monthly AI spending cap is reached', { monthUsd, capUsd: cap });
  await assertTokenCap(s, 0);
  const av = await availability(s, provider);
  if (!av.available || !provider) throw new AppError('AI_PROVIDER_ERROR', av.reason === 'offline' ? 'Claude cannot be reached: no network connection' : 'Claude is not available: no access is configured', { reason: av.reason ?? 'no-access' });

  const all = (await rt.store.documents.list()).filter((d) => !d.missing && aiVisible(d.path, cfg));
  if (all.length === 0) throw new AppError('INVALID_REQUEST', 'No document is in a folder enabled for AI', { reason: 'nothing-to-send' });
  const items = await digest(rt, all);
  const model = strongModel(cfg.ai.models, req.model);
  const chars = items.reduce((n, d) => n + d.title.length + (d.gist?.length ?? 0) + d.keywords.join(', ').length + 8, 0);
  const { preview } = await computePreview(s, ctx, { purpose: 'job:taxonomy', model, docIds: all.map((d) => d.id), promptChars: chars + 3000, perDocChars: 0 });
  if (cap !== null && preview.overCap) throw new AppError('AI_BUDGET_EXCEEDED', 'This job would go over the monthly AI spending cap', { monthUsd, capUsd: cap, estimatedUsd: preview.estimatedUsd });
  await assertTokenCap(s, preview.approxInputTokens);
  if (preview.needsConfirmation && !req.confirmed) throw new AppError('CONFLICT', 'The job needs the confirmation of the user', { reason: 'needs-confirmation', preview });

  const t = trackAbort();
  const deviceId = (await s.settings.get()).deviceId;
  const runner: Runner = { s, ctx, provider, signal: t.controller.signal, confirmed: req.confirmed, deviceId, addUsd: () => undefined };
  const per = TAXONOMY_LIMITS.titlesPerCall;
  let added = 0;
  let calls = 0;
  try {
    for (let i = 0; i < items.length && calls < BATCH_CALLS_MAX; i += per) {
      if (t.controller.signal.aborted) throw new AppError('CANCELLED', 'Cancelled');
      const tax = await rt.store.readTaxonomy();
      const nodesLive = tax.nodes.filter((n) => n.status !== 'deprecated');
      const mode = req.mode === 'build' && nodesLive.length === 0 ? 'build' : 'extend';
      // The folder gate and the configuration are read again for each batch: a folder disabled during a long build sends nothing more (M5).
      const live = await rt.store.readConfig();
      const idx = all.slice(i, i + per).map((d, k) => [d, i + k] as const).filter(([d]) => aiVisible(d.path, live));
      if (idx.length === 0) continue;
      const batch = idx.map(([d]) => d);
      const { value } = await callStructured({ ...runner, ctx: { ...ctx, cfg: live } }, {
        purpose: 'job:taxonomy',
        model,
        reasoning: req.reasoning,
        system: taxonomySystem(mode, live.language),
        prompt: taxonomyPrompt(idx.map(([, k]) => items[k]!), mode === 'extend' ? existingTaxonomyBlock(nodesLive.slice(0, 1500).map(nodeView)) : null),
        schema: taxonomySchema,
        docIds: batch.map((d) => d.id),
        folders: [...new Set(batch.map((d) => folderOf(d.path)))],
      });
      calls++;
      if (t.controller.signal.aborted) throw new AppError('CANCELLED', 'Cancelled');
      const proposal = cleanTaxonomyProposal(value as TaxonomyRaw, tax);
      if (proposal.length === 0) continue;
      const now = new Date().toISOString();
      const cs = (rt.store as OrganizerStore).withChange({ changeId: `chg-${randomUUID().replace(/-/g, '').slice(0, 24)}`, summary: `AI proposed ${proposal.length} taxonomy nodes` });
      await cs.updateTaxonomy((cur) => {
        // Re-cleaned against the taxonomy as it is NOW: a change made while the model answered counts.
        const fresh = cleanTaxonomyProposal(value as TaxonomyRaw, cur);
        const r = addCandidates(cur, fresh, now);
        added += r.added;
        return r.taxonomy;
      });
    }
  } finally {
    t.release();
  }
  if (added > 0) {
    s.emit('library:changed', { kind: 'taxonomy' });
  }
  return { added, calls };
}
