import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentRecord, TagAutoMode, TagAutoState, TagProposal, TagRun } from '@rl/core';
import { atomicWriteJson } from '@rl/core/node';
import type { CleanupInput, Proposal } from '@rl/data/tag-vocabulary';
import type { MainServices } from '../../ipc/handlers/services.js';

/** Run state, provenance migration and the shared pieces of the vocabulary review (loaded with the feature). */
export type Step = 1 | 2 | 3 | 4 | 5;
export interface Ai {
  verdict: 'same' | 'broader' | 'narrower' | 'related' | 'different';
  note: string;
}
export interface State {
  run: TagRun;
  dismissed: string[];
  ai: Record<string, Ai>;
  migrated: boolean;
  /** D-512: automatic acceptance, the proposals it already took (never taken again after an undo) and its last batch. */
  auto: TagAutoMode;
  autoDone: string[];
  autoLast: TagAutoState['last'];
}
export const emptyRun = (): TagRun => ({ startedAt: null, steps: [], before: null, dismissed: 0 });
export const FILE = 'tag-review.json';

function autoOf(v: Partial<State>): Pick<State, 'auto' | 'autoDone' | 'autoLast'> {
  return { auto: v.auto === 'sure' || v.auto === 'all' ? v.auto : 'off', autoDone: Array.isArray(v.autoDone) ? v.autoDone.slice(-5000) : [], autoLast: v.autoLast ?? null };
}

export async function readState(dataDir: string): Promise<State> {
  try {
    const v = JSON.parse(await readFile(path.join(dataDir, FILE), 'utf8')) as Partial<State>;
    return { run: v.run ?? emptyRun(), dismissed: Array.isArray(v.dismissed) ? v.dismissed.slice(0, 20_000) : [], ai: v.ai && typeof v.ai === 'object' ? v.ai : {}, migrated: v.migrated === true, ...autoOf(v) };
  } catch {
    return { run: emptyRun(), dismissed: [], ai: {}, migrated: false, auto: 'off', autoDone: [], autoLast: null };
  }
}
export const writeState = (dataDir: string, st: State): Promise<void> => atomicWriteJson(path.join(dataDir, FILE), { ...st, run: { ...st.run, dismissed: st.dismissed.length } });

export interface Loaded {
  tax: Awaited<ReturnType<MainServices['runtime']['require']>> extends infer R ? (R extends { store: { readTaxonomy(): Promise<infer T> } } ? T : never) : never;
  records: DocumentRecord[];
  input: CleanupInput;
}

export async function load(s: MainServices): Promise<{ rt: Awaited<ReturnType<MainServices['runtime']['require']>>; loaded: Loaded; state: State }> {
  const rt = await s.runtime.require();
  const state = await readState(rt.store.dataDir);
  if (!state.migrated) {
    await migrateOrigins(rt);
    state.migrated = true;
    await writeState(rt.store.dataDir, state).catch(() => undefined);
  }
  const tax = await rt.store.readTaxonomy();
  const records = (await rt.store.documents.list()).filter((d) => !d.missing);
  const input: CleanupInput = {
    nodes: tax.nodes,
    docs: records.map((d) => ({ id: d.id, tags: d.tags, authors: d.authors, type: d.type, venueId: d.ref.venueId ?? null, status: d.publication.status })),
    distinct: tax.distinct,
    venues: tax.venues,
    documentTypes: tax.documentTypes,
  };
  return { rt, loaded: { tax, records, input } as Loaded, state };
}

/** §19.1.2, once: tags the AI proposed and the user accepted -> `ai`; tags of imported nodes on documents of the old index -> `import`. */
async function migrateOrigins(rt: Awaited<ReturnType<MainServices['runtime']['require']>>): Promise<void> {
  const tax = await rt.store.readTaxonomy();
  const imported = new Set(tax.nodes.filter((n) => n.origin === 'import').map((n) => n.id));
  for (const d of await rt.store.documents.list()) {
    const ai = new Set<string>(d.ai.suggestedTags?.value ?? []);
    const next: Record<string, 'ai' | 'import'> = { ...(d.tagOrigin ?? {}) };
    for (const t of d.tags) {
      if (next[t] !== undefined) continue;
      if (ai.has(t)) next[t] = 'ai';
      else if (d.legacy !== undefined && imported.has(t)) next[t] = 'import';
    }
    if (Object.keys(next).length === Object.keys(d.tagOrigin ?? {}).length) continue;
    await rt.store.documents.update(d.id, (cur) => (cur ? { ...cur, tagOrigin: next } : (cur as unknown as DocumentRecord)));
  }
}

export const dismissedOf = (st: State, id: string): boolean => st.dismissed.includes(id);

export const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
export function aiKeyOf(labels: Map<string, string>, p: Proposal): string | null {
  if (p.tags.length !== 2) return null;
  return pairKey(labels.get(p.tags[0] as string) ?? '', labels.get(p.tags[1] as string) ?? '');
}

export function toView(p: Proposal, ai: Ai | undefined): TagProposal {
  return { ...p, ...(ai ? { ai } : {}) } as TagProposal;
}

export function applyAi(ps: Proposal[], state: State, labels: Map<string, string>): Proposal[] {
  // §19.1.3: "same" -> a likely row; "different" -> down to "maybe"; broader / narrower -> shown as a parent proposal by the interface.
  return ps.map((p) => {
    const k = aiKeyOf(labels, p);
    const a = k ? state.ai[k] : undefined;
    if (!a) return p;
    if (a.verdict === 'same' && p.confidence === 'maybe') return { ...p, confidence: 'likely' };
    if (a.verdict === 'different' && p.confidence === 'likely') return { ...p, confidence: 'maybe' };
    return p;
  });
}

/** How many applied steps stand after `step` in the run (D-504): a single-step undo is refused while there are any. */
export function laterApplied(applied: ReadonlyArray<{ step: number }>, step: number): number {
  const at = applied.findIndex((x) => x.step === step);
  return at < 0 ? 0 : applied.length - at - 1;
}
