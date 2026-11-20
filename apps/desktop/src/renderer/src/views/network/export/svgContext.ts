/**
 * A recording stand-in for `CanvasRenderingContext2D` that writes SVG (D-528): the subset `drawBlocks` uses (paths, arcs, rounded rectangles,
 * text, dashes, alpha, styles, save/restore). The picture is the one the canvas draws, with no second painter. Text is measured by a
 * delegate (an off-screen canvas in the app) so the layout of the labels matches. No DOM here: the caller supplies `measure`.
 */
export class SvgTooLargeError extends Error {
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super(`The SVG is larger than ${limit} characters`);
    this.name = 'SvgTooLargeError';
  }
}

interface Style {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  dash: number[];
  font: string;
  textAlign: string;
  textBaseline: string;
  lineCap: string;
  lineJoin: string;
}

const num = (v: number): string => String(Math.round(v * 100) / 100);
/** XML text and attribute escaping; characters XML 1.0 cannot hold are dropped. */
export function xmlEscape(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `600 12px system-ui, sans-serif` -> weight, size and family attributes. */
function fontAttrs(font: string): string {
  const m = /^\s*(?:(italic|oblique)\s+)?(?:(bold|bolder|lighter|\d{3})\s+)?([\d.]+)px\s+(.+)$/.exec(font);
  if (!m) return '';
  return `${m[1] ? ` font-style="${m[1]}"` : ''}${m[2] ? ` font-weight="${m[2]}"` : ''} font-size="${m[3]}" font-family="${xmlEscape(m[4]!.replace(/"/g, "'"))}"`;
}

export class SvgContext {
  fillStyle = '#000';
  strokeStyle = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  lineCap = 'butt';
  lineJoin = 'miter';
  private dash: number[] = [];
  private stack: Style[] = [];
  private parts: string[] = [];
  private size = 0;
  private d = '';
  /** The last element written by `fill`, so a `stroke` of the same path joins it (one element for a dot instead of two). */
  private joinable: { index: number; d: string; el: string } | null = null;
  private cx = 0;
  private cy = 0;
  private open = false;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly measure: (font: string, text: string) => number,
    /** Characters the whole document may take (the channel's limit); crossing it throws `SvgTooLargeError` at once. */
    private readonly limit = Infinity,
    background?: string,
  ) {
    if (background) this.push(`<rect width="${num(width)}" height="${num(height)}" fill="${xmlEscape(background)}"/>`);
  }

  private push(el: string): number {
    this.size += el.length + 1;
    if (this.size > this.limit) throw new SvgTooLargeError(this.size, this.limit);
    return this.parts.push(el) - 1;
  }

  // ---- state ----
  save(): void {
    this.stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha, dash: this.dash, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, lineCap: this.lineCap, lineJoin: this.lineJoin });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.lineWidth = s.lineWidth;
    this.globalAlpha = s.globalAlpha;
    this.dash = s.dash;
    this.font = s.font;
    this.textAlign = s.textAlign;
    this.textBaseline = s.textBaseline;
    this.lineCap = s.lineCap;
    this.lineJoin = s.lineJoin;
  }
  setLineDash(segments: number[]): void {
    this.dash = segments.length > 0 && segments.every((x) => x > 0) ? [...segments] : [];
  }
  getLineDash(): number[] {
    return [...this.dash];
  }
  measureText(text: string): { width: number } {
    return { width: this.measure(this.font, text) };
  }

  // ---- paths ----
  beginPath(): void {
    this.d = '';
    this.open = false;
    this.joinable = null;
  }
  closePath(): void {
    if (this.open) this.d += 'Z';
  }
  moveTo(x: number, y: number): void {
    this.d += `M${num(x)} ${num(y)}`;
    this.cx = x;
    this.cy = y;
    this.open = true;
  }
  lineTo(x: number, y: number): void {
    if (!this.open) return this.moveTo(x, y);
    this.d += `L${num(x)} ${num(y)}`;
    this.cx = x;
    this.cy = y;
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.open) this.moveTo(cpx, cpy);
    this.d += `Q${num(cpx)} ${num(cpy)} ${num(x)} ${num(y)}`;
    this.cx = x;
    this.cy = y;
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, anticlockwise = false): void {
    if (r < 0) return;
    const full = Math.PI * 2;
    const raw = a1 - a0;
    let sweep = raw;
    if (Math.abs(raw) < full - 1e-9) {
      if (anticlockwise) sweep = raw > 0 ? raw - full * Math.ceil(raw / full) : raw;
      else sweep = raw < 0 ? raw + full * Math.ceil(-raw / full) : raw;
    } else sweep = full;
    const sx = x + r * Math.cos(a0);
    const sy = y + r * Math.sin(a0);
    if (!this.open) this.moveTo(sx, sy);
    else if (Math.abs(this.cx - sx) > 1e-6 || Math.abs(this.cy - sy) > 1e-6) this.lineTo(sx, sy);
    if (Math.abs(sweep) >= full - 1e-9) {
      // A whole circle: two half arcs (one arc command cannot start and end at the same point).
      const ox = x + r * Math.cos(a0 + Math.PI);
      const oy = y + r * Math.sin(a0 + Math.PI);
      const flag = anticlockwise ? 0 : 1;
      this.d += `A${num(r)} ${num(r)} 0 1 ${flag} ${num(ox)} ${num(oy)}A${num(r)} ${num(r)} 0 1 ${flag} ${num(sx)} ${num(sy)}`;
      this.cx = sx;
      this.cy = sy;
      return;
    }
    const ex = x + r * Math.cos(a0 + sweep);
    const ey = y + r * Math.sin(a0 + sweep);
    this.d += `A${num(r)} ${num(r)} 0 ${Math.abs(sweep) > Math.PI + 1e-9 ? 1 : 0} ${sweep > 0 ? 1 : 0} ${num(ex)} ${num(ey)}`;
    this.cx = ex;
    this.cy = ey;
  }
  roundRect(x: number, y: number, w: number, h: number, radius: number | number[] = 0): void {
    const r = Math.max(0, Math.min(Array.isArray(radius) ? (radius[0] ?? 0) : radius, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + r, y);
    this.d += `H${num(x + w - r)}A${num(r)} ${num(r)} 0 0 1 ${num(x + w)} ${num(y + r)}V${num(y + h - r)}A${num(r)} ${num(r)} 0 0 1 ${num(x + w - r)} ${num(y + h)}H${num(x + r)}A${num(r)} ${num(r)} 0 0 1 ${num(x)} ${num(y + h - r)}V${num(y + r)}A${num(r)} ${num(r)} 0 0 1 ${num(x + r)} ${num(y)}Z`;
    this.cx = x + r;
    this.cy = y;
  }

  // ---- painting ----
  private fillAttrs(): string {
    return ` fill="${xmlEscape(this.fillStyle)}"${this.globalAlpha < 1 ? ` fill-opacity="${num(this.globalAlpha)}"` : ''}`;
  }
  private strokeAttrs(): string {
    const dash = this.dash.length > 0 ? ` stroke-dasharray="${this.dash.map(num).join(' ')}"` : '';
    return ` stroke="${xmlEscape(this.strokeStyle)}" stroke-width="${num(this.lineWidth)}"${this.globalAlpha < 1 ? ` stroke-opacity="${num(this.globalAlpha)}"` : ''}${dash}${this.lineCap !== 'butt' ? ` stroke-linecap="${this.lineCap}"` : ''}${this.lineJoin !== 'miter' ? ` stroke-linejoin="${this.lineJoin}"` : ''}`;
  }
  fill(): void {
    if (!this.d) return;
    const el = `<path d="${this.d}"${this.fillAttrs()}/>`;
    this.joinable = { index: this.push(el), d: this.d, el };
  }
  stroke(): void {
    if (!this.d) return;
    const j = this.joinable;
    if (j && j.d === this.d && j.index === this.parts.length - 1) {
      // The same path filled a moment ago: one element with both (the canvas paints the fill first, then the stroke, as SVG does).
      const merged = `<path d="${this.d}"${this.fillAttrs()}${this.strokeAttrs()}/>`;
      this.size += merged.length - j.el.length;
      if (this.size > this.limit) throw new SvgTooLargeError(this.size, this.limit);
      this.parts[j.index] = merged;
      this.joinable = null;
      return;
    }
    this.push(`<path d="${this.d}" fill="none"${this.strokeAttrs()}/>`);
  }

  private textEl(text: string, x: number, y: number, maxWidth: number | undefined, paint: string): void {
    if (text === '') return;
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' || this.textAlign === 'end' ? 'end' : 'start';
    const dy = this.textBaseline === 'middle' ? ' dy=".35em"' : '';
    // Canvas shrinks a text wider than `maxWidth`; SVG does so with textLength, only when the text is wider.
    const squeeze = maxWidth !== undefined && this.measure(this.font, text) > maxWidth ? ` textLength="${num(maxWidth)}" lengthAdjust="spacingAndGlyphs"` : '';
    this.push(`<text x="${num(x)}" y="${num(y)}"${dy}${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}${fontAttrs(this.font)}${squeeze}${paint}>${xmlEscape(text)}</text>`);
  }
  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.textEl(text, x, y, maxWidth, this.fillAttrs());
  }
  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    this.textEl(text, x, y, maxWidth, ` fill="none"${this.strokeAttrs()}`);
  }

  /** The document. */
  toString(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(this.width)}" height="${num(this.height)}" viewBox="0 0 ${num(this.width)} ${num(this.height)}">\n${this.parts.join('\n')}\n</svg>\n`;
  }
  /** Characters written so far (what the channel's limit counts). */
  get length(): number {
    return this.size;
  }
}
