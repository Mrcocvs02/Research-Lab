import { ancestorsOf, type GraphNode } from './closure.js';
import { vocabularyOf } from '../suggest.js';
import { clip, norm, oneLine, tokenize } from './text.js';

/** A taxonomy node as the candidate retrieval sees it. */
export interface CandidateNode extends GraphNode {
  label: string;
  aliases: readonly string[];
  definition?: string | undefined;
  status?: string | undefined;
  family?: 'one' | 'many' | 'keywords' | undefined;
}

/** The nodes the AI may tag with: the values of the one/many families (no family roots, keywords or loose tags), §19.1.6. */
export function vocabularyNodes<N extends CandidateNode>(nodes: readonly N[]): N[] {
  const voc = vocabularyOf(nodes);
  return nodes.filter((n) => voc.tags.has(n.id));
}

export interface Candidate {
  id: string;
  score: number;
  /** Why it is a candidate: text similarity with the note, an ancestor of a hit, or a neighbour (child or sibling) of a hit. */
  via: 'text' | 'ancestor' | 'neighbour';
}

export const CANDIDATE_LIMITS = { top: 60, hitsForGraph: 15, max: 150 } as const;

const tf = (tokens: readonly string[], weight = 1, into = new Map<string, number>()) => {
  for (const t of tokens) into.set(t, (into.get(t) ?? 0) + weight);
  return into;
};

/**
 * The nodes a document may be tagged with, from the text of its literature note (D-446 b): tf-idf cosine between the note and
 * each node (label x3, aliases x2, definition x1, idf over the nodes), a bonus for a label or alias that appears as a phrase in
 * the note, then the ANCESTORS and the NEIGHBOURS (children and siblings) of the best hits, so that implicit, more general or
 * more specific tags are offered too. At most `max` nodes, best first. Pure and deterministic.
 */
export function retrieveCandidates(noteText: string, nodes: readonly CandidateNode[], o: { top?: number; max?: number } = {}): Candidate[] {
  const top = o.top ?? CANDIDATE_LIMITS.top;
  const max = o.max ?? CANDIDATE_LIMITS.max;
  if (nodes.length === 0) return [];
  const docs = nodes.map((n) => {
    const m = tf(tokenize(n.label), 3);
    for (const a of n.aliases) tf(tokenize(a), 2, m);
    tf(tokenize(n.definition ?? ''), 1, m);
    return m;
  });
  const df = new Map<string, number>();
  for (const m of docs) for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + nodes.length / (df.get(t) ?? 1));
  const q = tf(tokenize(noteText));
  const qNorm = Math.sqrt([...q].reduce((a, [t, c]) => a + (c * idf(t)) ** 2, 0)) || 1;
  const hay = ` ${norm(noteText)} `;
  const scored = nodes.map((n, i) => {
    const m = docs[i]!;
    let dot = 0;
    let nn = 0;
    for (const [t, c] of m) {
      const w = c * idf(t);
      nn += w * w;
      const qc = q.get(t);
      if (qc) dot += w * qc * idf(t);
    }
    let s = dot / ((Math.sqrt(nn) || 1) * qNorm);
    for (const name of [n.label, ...n.aliases]) {
      const k = norm(name);
      if (k.length >= 3 && hay.includes(` ${k} `)) {
        s += 0.25;
        break;
      }
    }
    return { id: n.id, score: s };
  });
  const hits = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, top);
  const out = new Map<string, Candidate>(hits.map((h) => [h.id, { id: h.id, score: h.score, via: 'text' }]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const n of nodes) for (const p of n.parents) children.set(p, [...(children.get(p) ?? []), n.id]);
  const add = (id: string, score: number, via: Candidate['via']) => {
    if (out.size < max && byId.has(id) && !out.has(id)) out.set(id, { id, score, via });
  };
  const best = hits.slice(0, CANDIDATE_LIMITS.hitsForGraph);
  for (const h of best) for (const [anc, d] of ancestorsOf(byId, h.id)) add(anc, h.score * 0.7 ** d, 'ancestor');
  for (const h of best) {
    const n = byId.get(h.id)!;
    for (const c of children.get(h.id) ?? []) add(c, h.score * 0.5, 'neighbour');
    for (const p of n.parents) for (const sib of children.get(p) ?? []) add(sib, h.score * 0.4, 'neighbour');
  }
  return [...out.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, max);
}

/** The candidates as a delimited block, one per line: `- id | label | path | definition | aliases: a, b`. */
export function candidateBlock(cands: readonly Candidate[], nodes: readonly CandidateNode[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pathOf = (id: string) => {
    const labels: string[] = [];
    let cur = byId.get(id)?.parents[0];
    for (let i = 0; cur !== undefined && i < 12; i++) {
      const p = byId.get(cur);
      if (!p) break;
      labels.unshift(p.label);
      cur = p.parents[0];
    }
    return labels.join(' › ');
  };
  const lines = cands.flatMap((c) => {
    const n = byId.get(c.id);
    return n ? [`- ${n.id} | ${oneLine(n.label)} | ${oneLine(pathOf(n.id))} | ${clip(oneLine(n.definition ?? ''), 160)} | aliases: ${n.aliases.slice(0, 6).map(oneLine).join(', ')}`] : [];
  });
  const voc = vocabularyOf(nodes);
  const rules = [...new Set(cands.flatMap((c) => (voc.families && voc.one.has(voc.rootOf.get(c.id) ?? '') ? [oneLine(byId.get(voc.rootOf.get(c.id) as string)?.label ?? '')] : [])))].map((f) => `# at most one value of family ${f}`);
  return `<<<TAXONOMY\n${[...rules, ...lines].join('\n')}\nTAXONOMY>>>`;
}
