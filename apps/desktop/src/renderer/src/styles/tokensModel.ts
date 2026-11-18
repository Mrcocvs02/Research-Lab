/// <reference types="node" />
// Test support (not bundled): reads styles/tokens.css into per-theme token maps and computes WCAG 2.x contrast.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SRC = path.resolve(import.meta.dirname, '..');
export const TOKENS_CSS = path.join(import.meta.dirname, 'tokens.css');

export type Theme = Record<string, string>;
interface Block {
  selector: string;
  media: string | undefined;
  decls: Theme;
}

const norm = (s: string) => s.replace(/"/g, "'").replace(/\s+/g, ' ').trim();

/** Minimal CSS reader: top-level rules and one level of @media; enough for tokens.css. */
export function parseBlocks(css: string, media?: string): Block[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Block[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = norm(text.slice(i, open));
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith('@media')) out.push(...parseBlocks(body, head));
    else if (!head.startsWith('@')) {
      const decls: Theme = {};
      for (const d of body.split(';')) {
        const k = d.indexOf(':');
        if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim();
      }
      out.push({ selector: head, media, decls });
    }
    i = j;
  }
  return out;
}

const DARK_MEDIA = '@media (prefers-color-scheme: dark)';

export interface Themes {
  light: Theme;
  dark: Theme;
  indigoLight: Theme;
  indigoDark: Theme;
  /** Overrides declared under prefers-color-scheme (must equal the explicit dark ones). */
  darkMedia: Theme;
  indigoDarkMedia: Theme;
}

export function loadThemes(css = readFileSync(TOKENS_CSS, 'utf8')): Themes {
  const blocks = parseBlocks(css);
  const pick = (selector: string, media?: string): Theme => Object.assign({}, ...blocks.filter((b) => b.selector === norm(selector) && b.media === media).map((b) => b.decls));
  const light = pick(':root');
  const darkOver = pick(":root[data-theme='dark']");
  const dark = { ...light, ...darkOver };
  const indigoOver = pick(":root[data-accent='indigo']");
  const indigoDarkOver = pick(":root[data-theme='dark'][data-accent='indigo']");
  return {
    light,
    dark,
    indigoLight: { ...light, ...indigoOver },
    indigoDark: { ...dark, ...indigoDarkOver },
    darkMedia: pick(":root:not([data-theme='light'])", DARK_MEDIA),
    indigoDarkMedia: pick(":root[data-accent='indigo']:not([data-theme='light'])", DARK_MEDIA),
  };
}

/** Value of a token with var() references resolved. */
export function resolve(theme: Theme, name: string, depth = 0): string {
  const raw = theme[name.startsWith('--') ? name : `--${name}`];
  if (raw === undefined) throw new Error(`token ${name} is not defined`);
  if (depth > 8) throw new Error(`token ${name}: reference loop`);
  const m = /^var\((--[\w-]+)\)$/.exec(raw);
  return m ? resolve(theme, m[1]!, depth + 1) : raw;
}

export function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (WCAG 2.x, sRGB). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast of two tokens of a theme. */
export function tokenContrast(theme: Theme, fg: string, bg: string): number {
  return contrast(resolve(theme, fg), resolve(theme, bg));
}
