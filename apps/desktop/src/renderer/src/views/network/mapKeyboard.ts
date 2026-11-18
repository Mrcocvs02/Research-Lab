/** Keyboard of the map canvases (§4.20, §4.21.5): which key does what, and the nearest node in a direction. No DOM. */
export type Dir = 'left' | 'right' | 'up' | 'down';

export type MapAction =
  | { type: 'move'; dir: Dir }
  | { type: 'open' }
  | { type: 'read' }
  | { type: 'zoom'; factor: number }
  | { type: 'fit' }
  | { type: 'search' }
  | { type: 'pin' }
  | { type: 'escape' }
  | { type: 'mode' }
  | { type: 'explore' };

export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** The action of a key on the canvas, or null (the key is not ours). Arrows go to the nearest node; `[` and `]` stay as before (next, previous). */
export function mapAction(e: KeyLike): MapAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowLeft':
      return { type: 'move', dir: 'left' };
    case 'ArrowRight':
      return { type: 'move', dir: 'right' };
    case 'ArrowUp':
      return { type: 'move', dir: 'up' };
    case 'ArrowDown':
      return { type: 'move', dir: 'down' };
    case 'Enter':
      return e.shiftKey ? { type: 'read' } : { type: 'open' };
    case '+':
    case '=':
      return { type: 'zoom', factor: 1.25 };
    case '-':
    case '_':
      return { type: 'zoom', factor: 0.8 };
    case '0':
      return { type: 'fit' };
    case 'f':
    case 'F':
    case '/':
      return { type: 'search' };
    case 'p':
    case 'P':
      return { type: 'pin' };
    case 'Escape':
      return { type: 'escape' };
    case 'm':
    case 'M':
      return { type: 'mode' };
    case 'l':
    case 'L':
      return { type: 'explore' };
    default:
      return null;
  }
}

/**
 * The candidate nearest to `from` in a direction: within the quarter plane of the direction, scored by the distance plus twice
 * the sideways offset (so a node straight ahead beats a closer one off to the side). -1 when nothing lies that way.
 */
export function nearestInDirection(xs: ArrayLike<number>, ys: ArrayLike<number>, from: number, dir: Dir, candidates: Iterable<number>): number {
  const x0 = xs[from]!;
  const y0 = ys[from]!;
  const [ux, uy] = dir === 'left' ? [-1, 0] : dir === 'right' ? [1, 0] : dir === 'up' ? [0, -1] : [0, 1];
  let best = -1;
  let bestScore = Infinity;
  for (const i of candidates) {
    if (i === from) continue;
    const dx = xs[i]! - x0;
    const dy = ys[i]! - y0;
    const ahead = dx * ux + dy * uy;
    const side = Math.abs(dx * uy - dy * ux);
    if (ahead <= 0 || side > ahead * 1.5) continue;
    const score = ahead + side * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Keys of the nodes by the order of their screen position, for the first key press with nothing under the cursor: the top-left one. */
export function firstNode(xs: ArrayLike<number>, ys: ArrayLike<number>, candidates: Iterable<number>): number {
  let best = -1;
  let bestScore = Infinity;
  for (const i of candidates) {
    const s = ys[i]! * 4 + xs[i]!;
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}
