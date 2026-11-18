/** Tints of the Map: the palette of palette.css read once per theme, stable assignment, mixing. No DOM except `readTints`. */
export const TINTS = 10;
export const LIGHT_TINTS = ['#3e63dd', '#1f9d6b', '#c76f12', '#8e4ec6', '#d6409f', '#0b8c9c', '#9a8700', '#e5484d', '#5b6b8c', '#6e56cf'] as const;
export const DARK_TINTS = ['#7d97f0', '#56c79a', '#f0a860', '#b58ce6', '#ee7dbe', '#4fc6d4', '#dcc64f', '#ff7f83', '#8d9dbf', '#9d8af0'] as const;

/** `--cat-1..10` of the element, falling back to the built-in values (first frame, test DOMs). */
export function readTints(el: Element, dark: boolean): string[] {
  const css = getComputedStyle(el);
  const base = dark ? DARK_TINTS : LIGHT_TINTS;
  return base.map((d, i) => css.getPropertyValue(`--cat-${i + 1}`).trim() || d);
}

export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function parseColor(c: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128];
}

/** `a` and `b` mixed (t = share of `b`), as `rgb()`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)})`;
}

export function luminance(c: string): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseColor(c);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `color` with an alpha, for fills of hulls and halos. */
export function withAlpha(c: string, a: number): string {
  const [r, g, b] = parseColor(c);
  return `rgba(${r},${g},${b},${a})`;
}

/** The tint closest to a colour (RGB distance). */
export function nearestTint(color: string, tints: readonly string[]): string {
  const [r, g, b] = parseColor(color);
  let best = tints[0]!;
  let bestD = Infinity;
  for (const t of tints) {
    const [x, y, z] = parseColor(t);
    const d = (x - r) ** 2 + (y - g) ** 2 + (z - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** A colour the user gave to a tag: kept when it reads on the background (>= 3:1), else the closest tint (D-385). */
export function readableColor(color: string, bg: string, tints: readonly string[]): string {
  return contrast(color, bg) >= 3 ? color : nearestTint(color, tints);
}

export interface TintGroup {
  id: string;
  docs: readonly string[];
  /** Most characteristic terms, joined: the stable hash of a group with no ancestor. */
  key: string;
}
export interface TintMemo {
  docs: Set<string>;
  tint: number;
}

/** Circles (centre and radius) that touch or nearly do: the adjacency of the hulls. */
export function adjacencyOf(cx: ArrayLike<number>, cy: ArrayLike<number>, r: ArrayLike<number>): Array<Set<number>> {
  const n = cx.length;
  const adj = Array.from({ length: n }, () => new Set<number>());
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(cx[i]! - cx[j]!, cy[i]! - cy[j]!) < (r[i]! + r[j]!) * 1.1) {
        adj[i]!.add(j);
        adj[j]!.add(i);
      }
    }
  }
  return adj;
}

/**
 * Stable tints for the groups of a (re)built map (D-379): a new group inherits the tint of the old group it shares most
 * documents with (greedy, by decreasing overlap); the others take the tint their top terms hash to; hulls that touch never
 * share a tint, and when ten tints are not enough the tint repeats with a dashed outline.
 */
export function assignTints(groups: readonly TintGroup[], adj: ReadonlyArray<ReadonlySet<number>>, memo: readonly TintMemo[] | null): { tints: number[]; dashed: boolean[]; memo: TintMemo[] } {
  const n = groups.length;
  const want = new Array<number>(n).fill(-1);
  if (memo && memo.length > 0) {
    const owner = new Map<string, number>();
    memo.forEach((m, i) => m.docs.forEach((d) => owner.set(d, i)));
    const pairs: Array<[number, number, number]> = [];
    groups.forEach((g, gi) => {
      const count = new Map<number, number>();
      for (const d of g.docs) {
        const o = owner.get(d);
        if (o !== undefined) count.set(o, (count.get(o) ?? 0) + 1);
      }
      for (const [o, c] of count) pairs.push([c, gi, o]);
    });
    pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
    const used = new Set<number>();
    for (const [, gi, o] of pairs) {
      if (want[gi]! < 0 && !used.has(o)) {
        used.add(o);
        want[gi] = memo[o]!.tint;
      }
    }
  }
  const order = groups.map((_, i) => i).sort((a, b) => (want[b]! >= 0 ? 1 : 0) - (want[a]! >= 0 ? 1 : 0) || groups[b]!.docs.length - groups[a]!.docs.length || a - b);
  const tints = new Array<number>(n).fill(-1);
  const dashed = new Array<boolean>(n).fill(false);
  for (const gi of order) {
    const taken = new Set<number>();
    for (const nb of adj[gi] ?? []) if (tints[nb]! >= 0) taken.add(tints[nb]!);
    const first = want[gi]! >= 0 ? want[gi]! : hash32(groups[gi]!.key) % TINTS;
    let pick = -1;
    for (let s = 0; s < TINTS && pick < 0; s++) if (!taken.has((first + s) % TINTS)) pick = (first + s) % TINTS;
    if (pick < 0) {
      pick = first;
      dashed[gi] = true;
    }
    tints[gi] = pick;
  }
  return { tints, dashed, memo: groups.map((g, i) => ({ docs: new Set(g.docs), tint: tints[i]! })) };
}

/** One tint per key (tag branches, topics, an author's main topic): the hashed one, the next free one on a collision. Stable for the same keys. */
export function assignKeyTints(keys: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const k of [...new Set(keys)].sort()) {
    let t = hash32(k) % TINTS;
    for (let s = 0; s < TINTS && used.has(t); s++) t = (t + 1) % TINTS;
    used.add(t);
    out.set(k, t);
  }
  return out;
}

/** What a canvas needs from the theme, read once per theme change. */
export interface MapTheme {
  dark: boolean;
  text: string;
  muted: string;
  accent: string;
  bg: string;
  surface: string;
  border: string;
  tints: string[];
}

export function readTheme(el: Element, dark: boolean): MapTheme {
  const css = getComputedStyle(el);
  const get = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
  return {
    dark,
    text: css.color || (dark ? '#ececef' : '#1b1c1f'),
    muted: get('--text-muted', dark ? '#a9acb5' : '#555963'),
    accent: get('--accent', dark ? '#5cc6d1' : '#0f6e78'),
    bg: get('--bg', dark ? '#121316' : '#f6f5f1'),
    surface: get('--surface', dark ? '#1a1b1f' : '#ffffff'),
    border: get('--border', dark ? '#33353c' : '#dedcd5'),
    tints: readTints(el, dark),
  };
}

/** A soft round sprite of a colour (radial gradient), drawn once on an off-screen canvas and reused as the halo of a hovered node. */
const sprites = new Map<string, HTMLCanvasElement>();
export function haloSprite(color: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  let c = sprites.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, withAlpha(color, 0.55));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    sprites.set(color, c);
  }
  return c;
}
