import type { AiNewTag, LibraryStore, Logger, TaxonomyFile } from '@rl/core';
import { applyTaxonomyOps } from '@rl/data';
import type { VocabPackState } from '@rl/core/vocab';
import { materialization, type Materialization } from './materialize.js';
import { recordRoot } from './index.js';
import { loadPack, type LoadedPack } from './packs.js';
import { activeState } from './state.js';

/** What accepting an AI proposal "from the field" needs (D-519): the pack in use, to link the new tag and make the ancestors it lacks. */
export interface PackCtx {
  state: VocabPackState;
  loaded: LoadedPack;
  lang: 'it' | 'en';
}

export async function packContext(dataDir: string, lang: 'it' | 'en'): Promise<PackCtx | null> {
  const state = await activeState(dataDir);
  if (!state) return null;
  const loaded = await loadPack(state.packId).catch(() => null);
  return loaded ? { state, loaded, lang } : null;
}

/** The concept a `<packId>/<conceptId>` reference names in this pack, or null (another pack, or a concept that is gone). */
export const conceptOf = (ctx: PackCtx, ref: string): string | null => {
  const id = ref.startsWith(`${ctx.state.packId}/`) ? ref.slice(ctx.state.packId.length + 1) : '';
  return ctx.loaded.byId.has(id) ? id : null;
};

/** The operations that make the concept a tag (ancestors included); `own` is what the user changed in the review. */
export const planFor = (tax: TaxonomyFile, ctx: PackCtx, conceptId: string, own: { label?: string | undefined; parentId?: string | null | undefined }): Materialization | { depth: true } =>
  materialization(tax, ctx.state, ctx.loaded, conceptId, ctx.lang, own);

/**
 * The tags of the accepted proposals "from the field" (D-519), in the change `cs` of the review: each concept becomes a tag linked to it
 * (the ancestors it lacks too, `origin: 'ai'` on the tag itself), `idByLabel` learns its id and `created` the new tag. Only the tag itself
 * can be dropped again if no paper ends up using it; the ancestors stay (the Vocabulary shows only what is used).
 */
export async function createFromField(
  log: Logger,
  dataDir: string,
  cs: Pick<LibraryStore, 'updateTaxonomy'>,
  ctx: PackCtx,
  entries: ReadonlyArray<[string, { t: AiNewTag; concept: string }]>,
  idByLabel: Map<string, string>,
  created: Set<string>,
  now: string,
): Promise<void> {
  const roots: Array<{ family: string; id: string }> = [];
  await cs.updateTaxonomy((cur) => {
    let tax = cur;
    for (const [key, { t, concept }] of entries) {
      const plan = planFor(tax, ctx, concept, { label: t.label, parentId: t.parentId });
      if ('depth' in plan) continue;
      tax = applyTaxonomyOps(tax, plan.ops, new Map(), now).taxonomy;
      const node = tax.nodes.find((n) => n.id === plan.nodeId);
      if (node) node.origin = 'ai';
      idByLabel.set(key, plan.nodeId);
      if (plan.created.includes(plan.nodeId)) created.add(plan.nodeId);
      if (plan.root) roots.push(plan.root);
    }
    return tax;
  });
  for (const r of roots) await recordRoot(dataDir, r.family, r.id).catch((e: unknown) => log.warn('could not record a family root of the field vocabulary', { error: e }));
}
