import { isDarkTheme } from '../../../lib/theme';
import { drawBlocks, dotX, dotY, loadMetas, type BlocksFrame, type BlockView } from '../blocksDraw';
import { readTheme, type MapTheme } from '../colors';
import { adjacency, bundleEdges, selectEdges, K_SELECTED } from '../edges';
import { fitView, toScreenX, toScreenY, type View } from '../geometry';
import { centralPapers } from '../labelsLod';
import type { ExportCtx } from '../mapExtras';
import { SvgContext } from './svgContext';

/** Pictures of the Map for a file (D-528): the same `drawBlocks` as the screen, on an off-screen canvas (PNG) or a recording context (SVG). */
export type Area = 'view' | 'all';
export interface Frame {
  v: View;
  w: number;
  h: number;
}
/** Largest side of a PNG in pixels and of the logical picture of the whole map; the base64 text the channel takes; the area of a canvas. */
export const MAX_SIDE = 8192;
export const MAX_PNG_CHARS = 8_000_000;
export const MAX_SVG_CHARS = 2_000_000;
const MAX_AREA = 36_000_000;
const MARGIN = 24;

/** The frame of the picture: the live canvas (current view) or the whole map at the size where the cells are drawn in full. */
export function frameFor(area: Area, c: Pick<ExportCtx, 'bv' | 'camera'>, live: { w: number; h: number } | null): Frame {
  const bv = c.bv!;
  if (area === 'view') {
    const w = Math.max(200, Math.round(live?.w ?? 1200));
    const h = Math.max(150, Math.round(live?.h ?? 800));
    return { w, h, v: c.camera ? { ...c.camera } : fitView(bv.bounds, w, h) };
  }
  const bw = Math.max(bv.bounds.maxX - bv.bounds.minX, 1);
  const bh = Math.max(bv.bounds.maxY - bv.bounds.minY, 1);
  // 1 world unit = 1 px when the map fits in 4096 px a side (the PNG is then 2x, at most MAX_SIDE), smaller otherwise.
  const k = Math.min(1, (MAX_SIDE / 2 - 2 * MARGIN) / Math.max(bw, bh));
  return { w: Math.ceil(bw * k) + 2 * MARGIN, h: Math.ceil(bh * k) + 2 * MARGIN, v: { cx: (bv.bounds.minX + bv.bounds.maxX) / 2, cy: (bv.bounds.minY + bv.bounds.maxY) / 2, k } };
}

/** The theme of the live map (or the page, with no canvas). */
export const exportTheme = (el: Element | null): MapTheme => readTheme(el ?? document.body, isDarkTheme());

function frameOf(c: ExportCtx, fr: Frame, ctx: CanvasRenderingContext2D, th: MapTheme): BlocksFrame {
  const bv = c.bv!;
  const adj = adjacency(c.edges);
  const sel = c.selected ? (bv.index.get(c.selected) ?? -1) : -1;
  const shown = c.edgeMode === 'strong' ? bundleEdges(selectEdges('strong', adj, []), (id) => bv.block[bv.index.get(id) ?? -1] ?? -1) : { single: selectEdges(c.edgeMode, adj, [c.selected]), bundles: [] };
  const neighbors = new Set<number>();
  if (c.selected) for (const e of (adj.get(c.selected) ?? []).slice(0, K_SELECTED)) neighbors.add(bv.index.get(e.a === c.selected ? e.b : e.a) ?? -1);
  neighbors.delete(-1);
  const central = centralPapers(Float64Array.from(bv.ids, (id) => adj.get(id)?.length ?? 0), bv.block);
  const idx = (ids: readonly string[]) => new Set(ids.map((id) => bv.index.get(id)).filter((i): i is number => i !== undefined));
  return {
    ctx,
    w: fr.w,
    h: fr.h,
    v: fr.v,
    bv,
    th,
    hover: -1,
    sel,
    cursor: -1,
    lit: -1,
    edges: shown.single,
    bundles: shown.bundles,
    forced: neighbors,
    central,
    allow: c.allow,
    fly: null,
    redraw: () => undefined,
    extras: { multi: idx(c.multi), isolated: idx(c.isolated) },
  };
}

/** Fetches the titles of the papers in the frame (at most 400) so the labels are in the picture. */
async function withTitles(bv: BlockView, fr: Frame): Promise<void> {
  const ids: string[] = [];
  for (let i = 0; i < bv.ids.length && ids.length < 400; i++) {
    const x = toScreenX(fr.v, dotX(bv, i), fr.w);
    const y = toScreenY(fr.v, dotY(bv, i), fr.h);
    if (x > -10 && y > -10 && x < fr.w + 10 && y < fr.h + 10) ids.push(bv.ids[i]!);
  }
  await loadMetas(ids, 400);
}

/** The picture as an SVG document; throws `SvgTooLargeError` as soon as it would pass `limit` characters (nothing is written then). */
export async function renderSvg(c: ExportCtx, area: Area, live: { w: number; h: number } | null, el: Element | null, limit = MAX_SVG_CHARS): Promise<string> {
  const fr = frameFor(area, c, live);
  const th = exportTheme(el);
  const meas = document.createElement('canvas').getContext('2d');
  const measure = (font: string, text: string): number => {
    if (!meas) return text.length * 6.5;
    meas.font = font;
    return meas.measureText(text).width;
  };
  await withTitles(c.bv!, fr);
  const svg = new SvgContext(fr.w, fr.h, measure, limit, th.bg);
  drawBlocks(frameOf(c, fr, svg as unknown as CanvasRenderingContext2D, th));
  return svg.toString();
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const blobOf = (cv: HTMLCanvasElement): Promise<Blob | null> => new Promise((res) => cv.toBlob(res, 'image/png'));

/** The picture as a PNG in base64, at 2x when it fits (at most `MAX_SIDE` a side and the channel's text limit), smaller until it does. */
export async function renderPng(c: ExportCtx, area: Area, live: { w: number; h: number } | null, el: Element | null): Promise<{ base64: string; scale: number }> {
  const fr = frameFor(area, c, live);
  const th = exportTheme(el);
  await withTitles(c.bv!, fr);
  let scale = Math.min(2, MAX_SIDE / Math.max(fr.w, fr.h), Math.sqrt(MAX_AREA / (fr.w * fr.h)));
  for (let attempt = 0; attempt < 8; attempt++) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(fr.w * scale));
    cv.height = Math.max(1, Math.round(fr.h * scale));
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('No canvas');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, fr.w, fr.h);
    drawBlocks(frameOf(c, fr, ctx, th));
    const blob = await blobOf(cv);
    if (!blob) throw new Error('No image');
    const base64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
    if (base64.length <= MAX_PNG_CHARS) return { base64, scale };
    scale *= 0.75;
  }
  throw new Error('The image is too large');
}

/** The pixels of the live canvas as a PNG in base64 (the free layout, which is drawn by another painter). */
export async function copyPng(cv: HTMLCanvasElement): Promise<{ base64: string; scale: number }> {
  const blob = await blobOf(cv);
  if (!blob) throw new Error('No image');
  const base64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
  if (base64.length > MAX_PNG_CHARS) throw new Error('The image is too large');
  return { base64, scale: 1 };
}
