/** Pure model of the Vocabulary view (section 19.2.7): the tree of a family, a row per leaf (no collisions by construction), at most 40 nodes in view. */
export interface VocabSource {
  id: string;
  label: string;
  parents: readonly string[];
  /** Papers under the node, itself included. */
  subtree: number;
}

export interface VNode {
  id: string;
  label: string;
  count: number;
  /** 1 for a value of the family, 2 for its sub-topic, 3 for what a click opened. */
  depth: number;
  children: VNode[];
  /** Children left out of the view ("+N"). */
  more: number;
}

export const MAX_VOCAB_NODES = 40;

/**
 * The tree to draw: `roots` (the values of the family, level 1) with their children (level 2), the biggest first; the level 3 of the nodes
 * in `opened` as well. Past `cap` nodes the rest of each parent is counted in `more`, the cap shared between the parents in turns.
 */
export function buildVocabTree(roots: ReadonlyArray<{ id: string; label: string }>, nodes: readonly VocabSource[], opened: ReadonlySet<string> = new Set(), cap = MAX_VOCAB_NODES): VNode[] {
  const kids = new Map<string, VocabSource[]>();
  for (const n of nodes) {
    if (n.subtree <= 0) continue;
    for (const p of n.parents) (kids.get(p) ?? kids.set(p, []).get(p)!).push(n);
  }
  const by = (a: VocabSource, b: VocabSource): number => b.subtree - a.subtree || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  for (const list of kids.values()) list.sort(by);
  const count = new Map(nodes.map((n) => [n.id, n.subtree]));
  const top: VNode[] = roots.map((r) => ({ id: r.id, label: r.label, count: count.get(r.id) ?? 0, depth: 1, children: [], more: 0 }));
  const seen = new Set(top.map((r) => r.id));
  let budget = Math.max(0, cap - top.length);
  const take = (parent: VNode, list: VocabSource[], at: number): boolean => {
    const k = list[at];
    if (!k || budget <= 0 || seen.has(k.id)) return false;
    seen.add(k.id);
    budget--;
    parent.children.push({ id: k.id, label: k.label, count: k.subtree, depth: parent.depth + 1, children: [], more: 0 });
    return true;
  };
  const lists = top.map((r) => kids.get(r.id) ?? []);
  for (let rank = 0; top.some((_, i) => rank < lists[i]!.length); rank++) top.forEach((r, i) => take(r, lists[i]!, rank));
  top.forEach((r, i) => {
    r.more = Math.max(0, lists[i]!.length - r.children.length);
    for (const c of r.children) {
      const sub = (kids.get(c.id) ?? []).filter((k) => !seen.has(k.id));
      if (opened.has(c.id)) {
        for (const k of sub) {
          seen.add(k.id);
          c.children.push({ id: k.id, label: k.label, count: k.subtree, depth: 3, children: [], more: 0 });
        }
      } else c.more = sub.length;
    }
  });
  return top;
}

export interface Placed {
  node: VNode;
  /** Column (depth - 1) and row (a leaf takes one row; a parent sits at the middle of its children). */
  col: number;
  row: number;
  /** Row of the "+N" line under the node's children (or under the leaf itself), when some are left out. */
  moreRow?: number;
  parent: Placed | null;
}

/** Rows and columns of the tree, left to right: every leaf (and every "+N" line) has its own row, so labels never overlap. */
export function layoutVocab(tree: readonly VNode[]): { placed: Placed[]; rows: number } {
  const placed: Placed[] = [];
  let next = 0;
  const walk = (n: VNode, parent: Placed | null): Placed => {
    const me: Placed = { node: n, col: n.depth - 1, row: 0, parent };
    placed.push(me);
    if (n.children.length === 0) {
      me.row = next++;
      if (n.more > 0) me.moreRow = next++;
      return me;
    }
    const sub = n.children.map((c) => walk(c, me));
    if (n.more > 0) me.moreRow = next++;
    me.row = (sub[0]!.row + sub[sub.length - 1]!.row) / 2;
    return me;
  };
  for (const r of tree) walk(r, null);
  return { placed, rows: next };
}
