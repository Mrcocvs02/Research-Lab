/** Navigation state of the zoomable exploration (pure, tested): where the user is and how to go back keeping the context. */
export type Dim = 'topic' | 'author' | 'venue';
export const DIMS: Dim[] = ['topic', 'author', 'venue'];

export interface Loc {
  dim: Dim;
  /** The node whose children are shown (null: the top level). */
  parentId: string | null;
  /** The node chosen in the list (its documents and related nodes are available). */
  selected: string | null;
}

export interface BackEntry {
  loc: Loc;
  /** What to call the place in "Back to ...". */
  label: string;
}

export const MAX_BACK = 50;

export const locKey = (dim: Dim, parentId: string | null): string => `${dim}|${parentId ?? ''}`;

/** The parent of a node given its path from the top (the path may or may not end with the node itself). */
export function parentFromPath(path: ReadonlyArray<{ id: string }>, nodeId: string): string | null {
  const last = path[path.length - 1];
  const upTo = last?.id === nodeId ? path.length - 1 : path.length;
  return upTo > 0 ? path[upTo - 1]!.id : null;
}

/** Pushes the current place on the stack (bounded) unless it is the one already on top. */
export function pushBack(stack: readonly BackEntry[], entry: BackEntry): BackEntry[] {
  const top = stack[stack.length - 1];
  if (top && top.loc.dim === entry.loc.dim && top.loc.parentId === entry.loc.parentId && top.loc.selected === entry.loc.selected) return [...stack];
  return [...stack, entry].slice(-MAX_BACK);
}
