import type { PrismaCounts, PrismaState } from '@rl/core';

/** The short list of reasons offered when a candidate is rejected (the user can also type one). */
export const REASONS = ['off-topic', 'wrong-type', 'wrong-language', 'already-known'] as const;

export interface Labels {
  identification: string;
  screening: string;
  included: string;
  identified: string;
  removedBefore: string;
  duplicates: string;
  screened: string;
  excluded: string;
  assessed: string;
  excludedFull: string;
  includedBox: string;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  head?: boolean;
}
export interface Layout {
  w: number;
  h: number;
  boxes: Box[];
  arrows: Array<[number, number, number, number]>;
  phases: Array<{ y: number; text: string }>;
}

const LEFT = { x: 90, w: 290 };
const RIGHT = { x: 420, w: 230 };
const LINE = 18;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const boxH = (lines: number) => 14 + lines * LINE;

/** Boxes and arrows of the PRISMA 2020 flow (identification, screening, included) from the counts. `name` turns a source or reason code into text. */
export function layoutPrisma(c: PrismaCounts, reasons: PrismaState['screeningReasons'], L: Labels, name: (code: string) => string): Layout {
  const total = c.identified.reduce((a, b) => a + b.count, 0);
  const boxes: Box[] = [];
  const arrows: Layout['arrows'] = [];
  const phases: Layout['phases'] = [];
  const GAP = 34;
  let y = 10;

  const identified = [`${L.identified} (n = ${total})`, ...c.identified.map((s) => `${clip(name(s.source), 30)} (n = ${s.count})`)];
  const removed = [`${L.removedBefore}`, `${L.duplicates} (n = ${c.duplicates})`];
  const rowA = Math.max(boxH(identified.length), boxH(removed.length));
  phases.push({ y: y + rowA / 2, text: L.identification });
  boxes.push({ ...LEFT, y, h: rowA, lines: identified, head: true }, { ...RIGHT, y, h: rowA, lines: removed });
  arrows.push([LEFT.x + LEFT.w, y + rowA / 2, RIGHT.x, y + rowA / 2]);
  arrows.push([LEFT.x + LEFT.w / 2, y + rowA, LEFT.x + LEFT.w / 2, y + rowA + GAP]);
  y += rowA + GAP;

  const screened = [`${L.screened} (n = ${c.screened})`];
  const excluded = [`${L.excluded} (n = ${c.excludedScreening})`, ...reasons.slice(0, 3).map((r) => `${clip(name(r.reason), 26)} (n = ${r.count})`)];
  const rowB = Math.max(boxH(screened.length), boxH(excluded.length));
  phases.push({ y: y + rowB / 2, text: L.screening });
  boxes.push({ ...LEFT, y, h: rowB, lines: screened }, { ...RIGHT, y, h: rowB, lines: excluded });
  arrows.push([LEFT.x + LEFT.w, y + rowB / 2, RIGHT.x, y + rowB / 2]);
  arrows.push([LEFT.x + LEFT.w / 2, y + rowB, LEFT.x + LEFT.w / 2, y + rowB + GAP]);
  y += rowB + GAP;

  const assessed = [`${L.assessed} (n = ${c.assessed})`];
  const full = [`${L.excludedFull} (n = ${c.excludedFull.reduce((a, b) => a + b.count, 0)})`, ...c.excludedFull.slice(0, 5).map((r) => `${clip(r.reason, 26)} (n = ${r.count})`)];
  const rowC = Math.max(boxH(assessed.length), boxH(full.length));
  boxes.push({ ...LEFT, y, h: rowC, lines: assessed }, { ...RIGHT, y, h: rowC, lines: full });
  arrows.push([LEFT.x + LEFT.w, y + rowC / 2, RIGHT.x, y + rowC / 2]);
  arrows.push([LEFT.x + LEFT.w / 2, y + rowC, LEFT.x + LEFT.w / 2, y + rowC + GAP]);
  y += rowC + GAP;

  const incl = [`${L.includedBox} (n = ${c.included})`];
  phases.push({ y: y + boxH(1) / 2, text: L.included });
  boxes.push({ ...LEFT, y, h: boxH(1), lines: incl, head: true });
  return { w: RIGHT.x + RIGHT.w + 10, h: y + boxH(1) + 10, boxes, arrows, phases };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Colours of the exported file: the same roles as the tokens of the app, light and (by the reader's setting) dark. */
const SVG_STYLE =
  ':root{--s:#ffffff;--b:#86847c;--t:#1b1c1f;--m:#555963;--a:#0f6e78;--h:#e3f1f2}' +
  '@media (prefers-color-scheme:dark){:root{--s:#1d1f24;--b:#8d9099;--t:#ececec;--m:#b0b3ba;--a:#4fb8c2;--h:#16373b}}' +
  'svg{background:var(--s);font:13px "Segoe UI",system-ui,sans-serif}' +
  '.bx{fill:var(--s);stroke:var(--b)}.bh{fill:var(--h);stroke:var(--a)}.tx{fill:var(--t)}.ph{fill:var(--m);font-size:12px}' +
  '.ar{stroke:var(--b);stroke-width:1.5;fill:none}.ah{fill:var(--b)}';

/** The diagram as a standalone SVG file (title and description for screen readers; text is escaped). */
export function toSvg(l: Layout, title: string): string {
  const boxes = l.boxes
    .map((b) => {
      const text = b.lines.map((t, i) => `<text class="tx" x="${b.x + 10}" y="${b.y + 20 + i * LINE}"${i === 0 ? ' font-weight="600"' : ''}>${esc(t)}</text>`).join('');
      return `<rect class="${b.head ? 'bh' : 'bx'}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"/>${text}`;
    })
    .join('');
  const arrows = l.arrows.map(([x1, y1, x2, y2]) => `<path class="ar" d="M${x1} ${y1}L${x2} ${y2}"/><path class="ah" d="M${x2} ${y2}l${x2 > x1 ? '-7 -4v8z' : '-4 -7h8z'}"/>`).join('');
  const phases = l.phases.map((p) => `<text class="ph" transform="translate(30 ${p.y}) rotate(-90)" text-anchor="middle">${esc(p.text)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${l.w} ${l.h}" width="${l.w}" height="${l.h}" role="img"><title>${esc(title)}</title><style>${SVG_STYLE}</style>${arrows}${boxes}${phases}</svg>\n`;
}

/** The same figures as a Markdown table (for a manuscript or a report). */
export function toMarkdown(c: PrismaCounts, reasons: PrismaState['screeningReasons'], L: Labels, title: string, name: (code: string) => string, stepHead: string, nHead: string): string {
  const row = (a: string, n: number) => `| ${a.replace(/\|/g, '/')} | ${n} |`;
  const rows = [
    ...c.identified.map((s) => row(`${L.identification}: ${L.identified} - ${name(s.source)}`, s.count)),
    row(`${L.identification}: ${L.duplicates}`, c.duplicates),
    row(`${L.screening}: ${L.screened}`, c.screened),
    row(`${L.screening}: ${L.excluded}`, c.excludedScreening),
    ...reasons.map((r) => row(`${L.screening}: ${L.excluded} - ${name(r.reason)}`, r.count)),
    row(L.assessed, c.assessed),
    row(L.excludedFull, c.excludedFull.reduce((a, b) => a + b.count, 0)),
    ...c.excludedFull.map((r) => row(`${L.excludedFull} - ${r.reason}`, r.count)),
    row(`${L.included}: ${L.includedBox}`, c.included),
  ];
  return `# ${title}\n\n| ${stepHead} | ${nHead} |\n| --- | ---: |\n${rows.join('\n')}\n`;
}
