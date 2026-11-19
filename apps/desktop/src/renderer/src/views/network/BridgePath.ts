/**
 * The path a bridge draws in the Map (§17.4.17): A, then the bridge as a ghost node (a work outside the library, dashed outline,
 * until it is imported), then B, joined by two dashed edges in `--accent`. Pure data, so the Map's canvas only has to draw it.
 */
export interface BridgeEnd {
  docId: string;
  title: string;
}
export interface BridgePathNode {
  id: string;
  title: string;
  /** `ghost`: not in the library, drawn with a dashed outline. */
  kind: 'doc' | 'ghost';
}
export interface BridgePath {
  nodes: [BridgePathNode, BridgePathNode, BridgePathNode];
  /** Pairs of indexes into `nodes`. */
  edges: [[0, 1], [1, 2]];
  dashed: true;
}

export function bridgePath(a: BridgeEnd, via: { key: string; title: string | null }, b: BridgeEnd): BridgePath {
  return {
    nodes: [
      { id: a.docId, title: a.title, kind: 'doc' },
      { id: `ghost:${via.key}`, title: via.title ?? via.key, kind: 'ghost' },
      { id: b.docId, title: b.title, kind: 'doc' },
    ],
    edges: [
      [0, 1],
      [1, 2],
    ],
    dashed: true,
  };
}

/** One to four dots for a score from 0 to 1 (a weak bridge still shows one). */
export const strengthDots = (score: number): 1 | 2 | 3 | 4 => Math.min(4, Math.max(1, Math.ceil(score * 4))) as 1 | 2 | 3 | 4;
