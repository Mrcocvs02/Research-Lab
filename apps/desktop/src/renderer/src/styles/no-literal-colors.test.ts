/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, TOKENS_CSS } from './tokensModel';

// 5.6: no literal colour outside styles/tokens.css. Excepted: the vendored pdf.js sheet (not ours) and the SVG icons (currentColor in tsx).
const PDFJS_SHEET = path.join(SRC, 'views/reader/pdfjs-viewer.css');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const NAMED = 'white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|brown|cyan|magenta|silver|gold|navy|teal|maroon|lime|olive|aqua|fuchsia';

/** Literal colours found in a stylesheet text: hex, rgb()/hsl()/hwb()/lab()/lch()/oklab()/oklch(), and named colours as values. */
export function literalColors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  for (const m of text.matchAll(/(?<![\w-])#[0-9a-fA-F]{3,8}(?![\w-])/g)) found.push(m[0]);
  for (const m of text.matchAll(/(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g)) found.push(m[0]);
  const named = new Set(NAMED.split('|'));
  for (const m of text.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
    for (const token of m[2]!.split(/[\s,()/]+/)) if (named.has(token.toLowerCase())) found.push(token);
  }
  return found;
}

describe('no literal colours outside tokens.css', () => {
  const sheets = walk(SRC).filter((f) => f.endsWith('.css') && f !== TOKENS_CSS && f !== PDFJS_SHEET);

  it('finds the stylesheets of the split (sanity)', () => {
    const names = sheets.map((f) => path.relative(SRC, f).replace(/\\/g, '/'));
    for (const n of ['styles/base.css', 'styles/shell.css', 'components/controls.css', 'components/overlays.css', 'views/library/library.css']) expect(names).toContain(n);
  });

  it.each(sheets.map((f) => [path.relative(SRC, f).replace(/\\/g, '/'), f] as const))('%s has none', (_n, file) => {
    expect(literalColors(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('the scanner catches hex, functional and named colours (and ignores tokens and keywords)', () => {
    expect(literalColors('a{color:#fff}')).toEqual(['#fff']);
    expect(literalColors('a{background:#1a2b3c80}')).toEqual(['#1a2b3c80']);
    expect(literalColors('a{box-shadow:0 1px 2px rgb(0 0 0 / .2)}')).toEqual(['rgb(']);
    expect(literalColors('a{color:rgba(0,0,0,.5)}')).toEqual(['rgba(']);
    expect(literalColors('a{border-color:white}')).toEqual(['white']);
    expect(literalColors('a{color:var(--text);background:transparent;border:1px solid currentColor}')).toEqual([]);
    expect(literalColors('#root{height:100%} .red-flag{margin:0} /* #fff */')).toEqual([]);
  });

  it('tokens.css is the one place that holds them (sanity)', () => {
    expect(literalColors(readFileSync(TOKENS_CSS, 'utf8')).length).toBeGreaterThan(100);
  });
});

describe('every var(--token) used is declared', () => {
  it('no stylesheet reads an undefined custom property', () => {
    const files = walk(SRC).filter((f) => f.endsWith('.css') && f !== PDFJS_SHEET);
    const texts = files.map((f) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
    const declared = new Set<string>();
    for (const t of texts) for (const m of t.matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]!);
    // Custom properties set from React inline styles.
    for (const f of walk(SRC).filter((x) => /\.tsx$/.test(x))) for (const m of readFileSync(f, 'utf8').matchAll(/['"`](--[\w-]+)['"`]\s*:/g)) declared.add(m[1]!);
    const missing = new Set<string>();
    texts.forEach((t, i) => {
      for (const m of t.matchAll(/var\((--[\w-]+)/g)) if (!declared.has(m[1]!)) missing.add(`${path.relative(SRC, files[i]!).replace(/\\/g, '/')}: ${m[1]}`);
    });
    expect([...missing]).toEqual([]);
  });
});
