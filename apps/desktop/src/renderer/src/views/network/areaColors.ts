import { AREA_TINTS, fromOklch, readableColor, toOklab } from './colors';

/**
 * Colour of a node by macro-area (D-483, section 18.3.4 step 7). The main process sends integer shares (`ar`) and the
 * centrality (`az`); this file only turns them into a colour: tints from the palette tokens, rotated a little per branch,
 * mixed in OKLab, with the chroma lowered for nodes that sit between areas or have only weak tags. Pure: no DOM.
 */
export interface AreaDef {
  id: string;
  label: string;
  count: number;
  branches: ReadonlyArray<{ id: string; count: number }>;
  /** The colour the user gave to the area node (`#rrggbb`). */
  color?: string | undefined;
}
/** Up to three triples `[area index, branch index (-1: none), share x 100]`. */
export type AreaTriples = ReadonlyArray<ReadonlyArray<number>>;

/** Index of the "other areas" tint among the tokens (`--area-other`) and of "no area" (`--area-none`). */
export const OTHER = AREA_TINTS;
export const NONE = AREA_TINTS + 1;
/** Rotation of the hue, in degrees, by the rank of the branch inside its area. */
const ROTATION = [0, 12, -12, 24, -24] as const;
const MEMO_KEY = 'rl.map.areaHues';

/** Slot of each area (0..6 a tint, 7 the "other areas" tint): the biggest seven keep or get a free tint, the rest share the grey. */
export function assignAreaSlots(defs: readonly AreaDef[], memo: Readonly<Record<string, number>> | null): { slots: number[]; memo: Record<string, number> } {
  const slots = new Array<number>(defs.length).fill(OTHER);
  const used = new Set<number>();
  const top = defs.slice(0, AREA_TINTS);
  top.forEach((d, i) => {
    const old = memo?.[d.id];
    if (old !== undefined && old >= 0 && old < AREA_TINTS && !used.has(old)) {
      slots[i] = old;
      used.add(old);
    }
  });
  top.forEach((_, i) => {
    if (slots[i] !== OTHER) return;
    for (let s = 0; s < AREA_TINTS; s++) {
      if (!used.has(s)) {
        slots[i] = s;
        used.add(s);
        break;
      }
    }
  });
  const next: Record<string, number> = {};
  top.forEach((d, i) => (next[d.id] = slots[i]!));
  return { slots, memo: next };
}

export function loadAreaMemo(): Record<string, number> | null {
  try {
    const raw = window.localStorage.getItem(MEMO_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as Record<string, number>) : null;
  } catch {
    return null;
  }
}
export function saveAreaMemo(memo: Record<string, number>): void {
  try {
    window.localStorage.setItem(MEMO_KEY, JSON.stringify(memo));
  } catch {
    /* private mode, blocked storage: the hues are just not remembered */
  }
}

/** Chroma factor k = 0.2 + 0.8 u (0.55 + 0.45 z): full for a node central in one area, faint between areas or with weak tags. */
export function chromaFactor(ar: AreaTriples, az: number): number {
  const kept = ar.filter((t) => (t[2] ?? 0) > 0);
  if (kept.length === 0) return 0.2;
  const pi = Math.max(...kept.map((t) => t[2]! / 100));
  const K = kept.filter((t) => t[2]! >= 10).length;
  const u = K <= 1 ? 1 : (pi - 1 / K) / (1 - 1 / K);
  return 0.2 + 0.8 * Math.max(0, Math.min(1, u)) * (0.55 + 0.45 * Math.max(0, Math.min(1, az / 100)));
}

/** The area (index) with the biggest share, or -1. */
export const mainArea = (ar: AreaTriples | undefined): number => {
  let best = -1;
  let q = 0;
  for (const t of ar ?? []) if (t[2]! > q) [best, q] = [t[0]!, t[2]!];
  return best;
};

/** Share (0..1) of an area in a node. */
export const shareIn = (ar: AreaTriples | undefined, area: number): number => ((ar ?? []).find((t) => t[0] === area)?.[2] ?? 0) / 100;

/** `#rrggbb` for the shares, or null for a node without area. `tokens` are the nine `--area-*` colours of the theme. */
export function mixAreaColor(ar: AreaTriples | undefined, az: number, slots: readonly number[], tokens: readonly string[]): string | null {
  if (!ar || ar.length === 0) return null;
  const total = ar.reduce((s, t) => s + (t[2] ?? 0), 0);
  if (total <= 0) return null;
  let L = 0;
  let a = 0;
  let b = 0;
  let C = 0;
  for (const t of ar) {
    const p = t[2]! / total;
    const [l0, a0, b0] = toOklab(tokens[slots[t[0]!] ?? OTHER] ?? tokens[OTHER]!);
    const rot = ((ROTATION[t[1]!] ?? 0) * Math.PI) / 180;
    const c0 = Math.hypot(a0, b0);
    const h0 = Math.atan2(b0, a0) + rot;
    L += p * l0;
    a += p * c0 * Math.cos(h0);
    b += p * c0 * Math.sin(h0);
    C += p * c0;
  }
  const k = chromaFactor(ar, az);
  const mag = Math.hypot(a, b);
  return fromOklch(L, mag < 0.01 ? 0 : k * C, Math.atan2(b, a));
}

/**
 * The colour the user chose for an area node, brought into the palette (§18.3.4): lightness within the range of the seven tints of
 * the theme, chroma at most 0.16, then readable on the background (>= 3:1) or the nearest tint.
 */
export function userTint(color: string, tokens: readonly string[], bg: string): string {
  const tints = tokens.slice(0, AREA_TINTS);
  const ls = tints.map((c) => toOklab(c)[0]);
  const [l, a, b] = toOklab(color);
  const L = Math.min(Math.max(l, Math.min(...ls)), Math.max(...ls));
  const C = Math.min(Math.hypot(a, b), 0.16);
  return readableColor(fromOklch(L, C, Math.atan2(b, a)), bg, tints);
}

/**
 * The slots and tokens to mix with: an area with a colour of the user takes an extra token (after the nine of the theme) instead of
 * its tint. Without user colours the arguments come back as they are.
 */
export function withUserTints(defs: readonly AreaDef[], slots: readonly number[], tokens: readonly string[], bg: string): { slots: readonly number[]; tokens: readonly string[] } {
  if (!defs.some((d) => d.color)) return { slots, tokens };
  const ext = [...tokens];
  const next = slots.map((s, i) => {
    const c = defs[i]?.color;
    if (!c) return s;
    ext.push(userTint(c, tokens, bg));
    return ext.length - 1;
  });
  return { slots: next, tokens: ext };
}

/** A cache of the colours of nodes by their shares, valid for one palette and theme (the key is the data itself). */
export function colorCache(slots: readonly number[], tokens: readonly string[]): (ar: AreaTriples | undefined, az: number | undefined) => string | null {
  const memo = new Map<string, string | null>();
  return (ar, az) => {
    if (!ar || ar.length === 0) return null;
    const key = `${ar.map((t) => t.join(',')).join(';')}|${az ?? 0}`;
    let c = memo.get(key);
    if (c === undefined) memo.set(key, (c = mixAreaColor(ar, az ?? 0, slots, tokens)));
    return c;
  };
}

/** What the legend and the pills need to know about the areas of the data on screen. */
export interface AreaMode {
  use: 'areas' | 'topics';
  /** Why the topics are used. */
  reason?: 'none' | 'single';
  /** Documents with an area when they are few. */
  sparse?: number;
}

/** Fallbacks (section 18.3.6): no area or only one -> colour by topic; under 20 % of the nodes with an area -> areas, with a note. */
export function areaFallback(defs: readonly AreaDef[] | undefined, withArea: number, total: number): AreaMode {
  if (!defs || defs.length === 0 || withArea === 0) return { use: 'topics', reason: 'none' };
  if (defs.length === 1) return { use: 'topics', reason: 'single' };
  if (total > 0 && withArea / total < 0.2) return { use: 'areas', sparse: withArea };
  return { use: 'areas' };
}

/** Whether the colour note (fallback to topics, or few nodes with an area) must be shown for these nodes. */
export function areaNoteNeeded(defs: readonly AreaDef[] | undefined, nodes: ReadonlyArray<{ ar?: AreaTriples | undefined }>): boolean {
  const f = areaFallback(defs, nodes.filter((n) => n.ar && n.ar.length > 0).length, nodes.length);
  return f.use === 'topics' || f.sparse !== undefined;
}

/** "Fisica 70 % · Informatica 30 %": the text of a hover card, from the shares. */
export function areaSummary(ar: AreaTriples | undefined, defs: readonly AreaDef[]): string {
  return (ar ?? []).map((t) => `${defs[t[0]!]?.label ?? ''} ${t[2]} %`).join(' · ');
}
