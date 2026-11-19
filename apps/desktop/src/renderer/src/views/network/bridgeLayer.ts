import { controlPoint } from './edges';
import type { BridgePath } from './BridgePath';

/** World positions of a bridge: the two documents and the work between them (outside the library), put off to one side of the line. */
export interface BridgeGeo {
  a: [number, number];
  g: [number, number];
  b: [number, number];
  titles: [string, string, string];
}

export function bridgeGeo(path: BridgePath, pos: (docId: string) => [number, number] | null): BridgeGeo | null {
  const a = pos(path.nodes[0].id);
  const b = pos(path.nodes[2].id);
  if (!a || !b) return null;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return { a, b, g: [(a[0] + b[0]) / 2 + dy * 0.25, (a[1] + b[1]) / 2 - dx * 0.25], titles: [path.nodes[0].title, path.nodes[1].title, path.nodes[2].title] };
}

/** Draws the path A, work, B on the canvas: two thick dashed edges in the accent colour, the work as a ghost (dashed outline), titles with a halo. */
export function drawBridge(ctx: CanvasRenderingContext2D, th: { accent: string; bg: string; text: string }, g: BridgeGeo, to: (p: [number, number]) => [number, number], short: (s: string) => string): void {
  const [a, m, b] = [to(g.a), to(g.g), to(g.b)];
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.setLineDash([9, 6]);
  for (const [p, q] of [[a, m], [m, b]] as const) {
    const c = controlPoint(p[0], p[1], q[0], q[1], 0.12);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.quadraticCurveTo(c.x, c.y, q[0], q[1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineWidth = 2.5;
  for (const p of [a, b]) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = th.bg;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(m[0], m[1], 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  [a, m, b].forEach((p, i) => {
    const text = short(g.titles[i]!);
    ctx.strokeStyle = th.bg;
    ctx.strokeText(text, p[0], p[1] - 18);
    ctx.fillStyle = th.text;
    ctx.fillText(text, p[0], p[1] - 18);
  });
  ctx.restore();
}

/** Centre and zoom that show the three points of a bridge in a view of `w` by `h` pixels. */
export function bridgeView(g: BridgeGeo, w: number, h: number): { x: number; y: number; k: number } {
  const xs = [g.a[0], g.g[0], g.b[0]];
  const ys = [g.a[1], g.g[1], g.b[1]];
  const sx = Math.max(...xs) - Math.min(...xs);
  const sy = Math.max(...ys) - Math.min(...ys);
  return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, k: Math.min(w / Math.max(sx * 1.6, 1e-9), h / Math.max(sy * 1.6, 1e-9)) };
}
