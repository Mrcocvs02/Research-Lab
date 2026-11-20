import { describe, expect, it, vi } from 'vitest';
import { layoutBlocks } from '../../../../../../../../packages/graph/src/blocks';
import type { MapTheme } from '../colors';
import { fitView } from '../geometry';
import { buildBlockView, drawBlocks, peekMeta, type BlocksFrame, type FamilyResponse } from '../blocksDraw';
import { SvgContext, SvgTooLargeError, xmlEscape } from './svgContext';

vi.mock('../../../lib/rl', () => ({
  rl: {
    invoke: async (_channel: string, p: { docId: string }) => {
      const n = Number(p.docId.slice(1));
      return { title: `Paper ${n} <x> & y`, authors: [`Surname${n}, Given`], year: 2000 + n, path: `p${n}.pdf` };
    },
  },
}));

const measure = (_font: string, text: string): number => text.length * 6.5;
const svg = (limit = Infinity) => new SvgContext(300, 200, measure, limit, '#fff');
const ctxOf = (s: SvgContext) => s as unknown as CanvasRenderingContext2D;
const theme: MapTheme = { dark: false, text: '#000', muted: '#555', accent: '#06c', warning: '#a60', bg: '#fff', surface: '#fff', border: '#ccc', tints: [], areas: Array.from({ length: 9 }, (_, i) => `#${(i + 1).toString(16).repeat(3)}`) };

/** Every start tag has an end (or is self-closing) and the document nests: a stand-in for an XML parser in a node test. */
function wellFormed(doc: string): boolean {
  const stack: string[] = [];
  for (const m of doc.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]!);
  }
  return stack.length === 0 && !/<(?![/a-zA-Z?!])/.test(doc) && !/&(?!amp;|lt;|gt;|quot;)/.test(doc);
}

describe('SvgContext', () => {
  it('writes paths, arcs, rounded rectangles and the style of each element', () => {
    const c = svg();
    c.strokeStyle = '#123456';
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(10, 20, 100, 50, 8);
    c.stroke();
    c.fillStyle = '#abcdef';
    c.globalAlpha = 0.35;
    c.beginPath();
    c.arc(50, 50, 4.5, 0, Math.PI * 2);
    c.fill();
    const doc = c.toString();
    expect(doc).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="300" height="200" viewBox="0 0 300 200">/);
    expect(doc).toContain('<rect width="300" height="200" fill="#fff"/>');
    expect(doc).toMatch(/<path d="M18 20H102A8 8 0 0 1 110 28V62A8 8 0 0 1 102 70H18A8 8 0 0 1 10 62V28A8 8 0 0 1 18 20Z" fill="none" stroke="#123456" stroke-width="2"\/>/);
    expect(doc).toMatch(/<path d="M54.5 50A4.5 4.5 0 1 1 45.5 50A4.5 4.5 0 1 1 54.5 50" fill="#abcdef" fill-opacity="0.35"\/>/);
    expect(wellFormed(doc)).toBe(true);
  });

  it('turns a half arc into one arc command, and a quadratic curve into Q', () => {
    const c = svg();
    c.beginPath();
    c.arc(10, 10, 4, Math.PI / 2, (Math.PI * 3) / 2);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(5, 10, 20, 0);
    c.stroke();
    const doc = c.toString();
    expect(doc).toMatch(/d="M10 14A4 4 0 0 1 10 6Z"/);
    expect(doc).toMatch(/d="M0 0Q5 10 20 0"/);
  });

  it('writes the dashes, the line cap and the text with its font, anchor and baseline', () => {
    const c = svg();
    c.setLineDash([4, 4]);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(10, 10);
    c.stroke();
    c.font = '600 12px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#000';
    c.fillText('Block <A> & "B"', 40, 15);
    c.lineWidth = 3;
    c.strokeStyle = '#fff';
    c.strokeText('halo', 40, 15);
    const doc = c.toString();
    expect(doc).toContain('stroke-dasharray="4 4"');
    expect(doc).toContain('stroke-linecap="round"');
    expect(doc).toContain('<text x="40" y="15" dy=".35em" text-anchor="middle" font-weight="600" font-size="12" font-family="system-ui, sans-serif" fill="#000">Block &lt;A&gt; &amp; &quot;B&quot;</text>');
    expect(doc).toMatch(/<text [^>]*fill="none" stroke="#fff" stroke-width="3"[^>]*>halo<\/text>/);
    expect(wellFormed(doc)).toBe(true);
  });

  it('squeezes a text wider than maxWidth with textLength, and only then', () => {
    const c = svg();
    c.fillText('0123456789', 0, 0, 20);
    c.fillText('01', 0, 10, 20);
    const [wide, narrow] = c.toString().split('\n').filter((l) => l.startsWith('<text'));
    expect(wide).toContain('textLength="20"');
    expect(narrow).not.toContain('textLength');
  });

  it('save and restore bring back the style and the dashes', () => {
    const c = svg();
    c.fillStyle = '#111';
    c.setLineDash([2, 3]);
    c.save();
    c.fillStyle = '#999';
    c.setLineDash([]);
    c.restore();
    expect(c.fillStyle).toBe('#111');
    expect(c.getLineDash()).toEqual([2, 3]);
  });

  it('measures through the delegate with the font in force', () => {
    const seen: string[] = [];
    const c = new SvgContext(10, 10, (font, text) => (seen.push(font), text.length * 2));
    c.font = '12px serif';
    expect(c.measureText('abcd').width).toBe(8);
    expect(seen).toEqual(['12px serif']);
  });

  it('joins a fill and the stroke of the same path in one element', () => {
    const c = svg();
    c.fillStyle = '#aaa';
    c.strokeStyle = '#bbb';
    c.beginPath();
    c.arc(5, 5, 2, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    const paths = c.toString().split('\n').filter((l) => l.startsWith('<path'));
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('fill="#aaa"');
    expect(paths[0]).toContain('stroke="#bbb"');
  });

  it('drops characters XML cannot hold and escapes the others', () => {
    expect(xmlEscape('a\u0000b\u000Bc<&>"')).toBe('abc&lt;&amp;&gt;&quot;');
  });

  it('stops at once past the limit: an error and no document', () => {
    const c = svg(400);
    c.fillStyle = '#000';
    expect(() => {
      for (let i = 0; i < 50; i++) c.fillText(`text number ${i}`, 0, i);
    }).toThrow(SvgTooLargeError);
    const big = svg(200_000);
    expect(() => big.fillText('x', 0, 0)).not.toThrow();
  });
});

const ids = Array.from({ length: 12 }, (_, i) => `d${i}`);
function view() {
  const docs = ids.map((id, i) => ({ id, value: `v${i < 6 ? 0 : i < 10 ? 1 : 2}`, x: i % 4, y: Math.floor(i / 4) }));
  const l = layoutBlocks({ docs, labels: new Map([['v0', 'First block'], ['v1', 'Second block'], ['v2', 'Third block']]), aspect: 1.6 });
  const items: FamilyResponse['items'] = ids.map((id, i) => ({ id, cell: l.cells.get(id)!, block: l.blockOf.get(id)!.block, others: l.blockOf.get(id)!.others, ...(i === 1 ? { st: 1 as const } : i === 2 ? { st: 2 as const } : {}) }));
  return buildBlockView(items, l.blocks);
}

describe('drawBlocks into an SVG', () => {
  it('draws the same picture: block names, papers, reading marks and labels, as valid SVG', async () => {
    const bv = view();
    const v = fitView(bv.bounds, 800, 500);
    const frame = (s: SvgContext): BlocksFrame => ({ ctx: ctxOf(s), w: 800, h: 500, v, bv, th: theme, hover: -1, sel: 3, cursor: -1, lit: -1, edges: [{ a: 'd3', b: 'd8', e: 1, kinds: ['cites'] }], bundles: [], forced: new Set(), central: new Set(), allow: null, fly: null, redraw: () => undefined, extras: { isolated: new Set([5]), multi: new Set([0, 4]) } });
    drawBlocks(frame(new SvgContext(800, 500, measure, Infinity, theme.bg)));
    await vi.waitFor(() => expect(peekMeta('d11')).not.toBeNull());
    const s = new SvgContext(800, 500, measure, Infinity, theme.bg);
    const out = drawBlocks(frame(s));
    const doc = s.toString();
    expect(wellFormed(doc)).toBe(true);
    expect(doc).toContain('First block (6)');
    expect(doc).toContain('Paper 11 &lt;x&gt; &amp; y');
    expect(doc).toContain(`stroke="${theme.warning}"`);
    expect(doc).toContain('stroke-dasharray="2 3"');
    expect(out.labels.length).toBeGreaterThan(6);
    expect(out.marks).toHaveLength(1);
    // A tick and a half dot: the same marks a canvas draws.
    expect((doc.match(/<text /g) ?? []).length).toBeGreaterThanOrEqual(out.labels.length + out.names.length);
  });

  it('refuses a document over the limit with SvgTooLargeError, before anything is returned', () => {
    const bv = view();
    const s = new SvgContext(800, 500, measure, 600, theme.bg);
    const f: BlocksFrame = { ctx: ctxOf(s), w: 800, h: 500, v: fitView(bv.bounds, 800, 500), bv, th: theme, hover: -1, sel: -1, cursor: -1, lit: -1, edges: [], bundles: [], forced: new Set(), central: new Set(), allow: null, fly: null, redraw: () => undefined };
    expect(() => drawBlocks(f)).toThrow(SvgTooLargeError);
  });
});
