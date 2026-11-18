#!/usr/bin/env node
// Writes apps/desktop/src/renderer/src/views/reader/pdfjs-viewer.css: the part of pdf.js's `web/pdf_viewer.css` that the
// reader needs (the page, the canvas wrapper, the text layer, the link layer), with every selector prefixed by
// `.reader-scroll` so nothing of pdf.js can reach the rest of the app (D-346). The full file is the viewer of Firefox
// (sidebar, dialogs, editors, toolbars): importing it whole leaked 156 rules into the whole window.
//   node tools/vendor-pdfjs-css.mjs           regenerate the committed file
//   node tools/vendor-pdfjs-css.mjs --check   fail (exit 1) when the committed file differs from the installed version
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
export const OUTPUT = path.join(root, 'apps/desktop/src/renderer/src/views/reader/pdfjs-viewer.css');
export const SCOPE = '.reader-scroll';

/** First-compound classes that are kept (everything else in the file belongs to the Firefox viewer). */
const KEEP = /^(\.(pdfViewer|page|canvasWrapper|textLayer|annotationLayer|hiddenCanvasElement)|\[data-main-rotation)(?![\w-])/;
/** Selectors dropped even when they start with a kept class: editors, XFA forms, the loading animation (its image is not bundled). */
const DROP = /[Ee]ditor|xfa|Presentation|[Dd]ialog|[Ss]idebar|[Cc]omment|loadingIcon|\.loading\b|\.newBadge/;

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Splits a block body into items: `{ prelude, body }` for a nested block, `{ decl }` for a declaration. Quotes and parentheses are respected. */
function items(text) {
  const out = [];
  let depth = 0;
  let paren = 0;
  let quote = '';
  let start = 0;
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '{' && paren === 0) {
      if (depth++ === 0) open = i;
    } else if (c === '}' && paren === 0) {
      if (--depth === 0) {
        out.push({ prelude: text.slice(start, open).trim(), body: text.slice(open + 1, i) });
        start = i + 1;
      }
    } else if (c === ';' && depth === 0 && paren === 0) {
      const decl = text.slice(start, i).trim();
      if (decl) out.push({ decl });
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail && depth === 0) out.push({ decl: tail });
  return out;
}

/** A selector list split at the commas outside parentheses and brackets. */
function splitSelectors(list) {
  const out = [];
  let paren = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') paren++;
    else if (c === ')' || c === ']') paren--;
    else if (c === ',' && paren === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

const keepSelector = (sel) => KEEP.test(sel) && !DROP.test(sel);
const varsUsed = (text) => [...text.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

/** Custom properties declared anywhere in a `:root` body (also inside its nested `@media`): `{ name, value, wrap }`. */
function rootProps(body, wrap = '') {
  const out = [];
  for (const it of items(body)) {
    if (it.decl !== undefined) {
      const m = /^(--[\w-]+)\s*:\s*([\s\S]*)$/.exec(it.decl);
      if (m) out.push({ name: m[1], value: m[2].trim(), wrap });
    } else if (it.prelude.startsWith('@media')) out.push(...rootProps(it.body, it.prelude));
  }
  return out;
}

function filterRules(css, kept, roots) {
  for (const it of items(css)) {
    if (it.decl !== undefined) continue;
    const { prelude, body } = it;
    if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
      const inner = [];
      const innerRoots = [];
      filterRules(body, inner, innerRoots);
      if (inner.length > 0) kept.push({ at: prelude, rules: inner });
      for (const r of innerRoots) roots.push({ ...r, wrap: prelude });
    } else if (prelude.startsWith('@')) {
      // @keyframes and the like belong to widgets that are not kept.
    } else if (prelude === ':root') roots.push(...rootProps(body));
    else {
      const sels = splitSelectors(prelude).filter(keepSelector);
      if (sels.length > 0) kept.push({ sels, body: body.replace(/^\s*\n/, '').replace(/\s+$/, '') });
    }
  }
}

const flat = (node) => (node.at ? node.rules.map(flat).join('') : `${node.sels.join(',')}{${node.body}}`);

function emit(node, indent) {
  const pad = '  '.repeat(indent);
  if (node.at) return `${pad}${node.at} {\n${node.rules.map((r) => emit(r, indent + 1)).join('\n')}\n${pad}}\n`;
  const sels = node.sels.map((s) => `${pad}${s.startsWith('[') || s.startsWith('.') ? `${SCOPE} ${s}` : s}`).join(',\n');
  return `${sels} {\n${node.body}\n${pad}}\n`;
}

/** The filtered, prefixed sheet for a given `pdf_viewer.css` text and pdf.js version. Pure: the test calls it directly. */
export function generate(source, version) {
  const kept = [];
  const roots = [];
  filterRules(stripComments(source), kept, roots);

  // Custom properties: only the ones the kept rules read, and the ones those read in turn.
  const needed = new Set(varsUsed(kept.map(flat).join('')));
  const props = new Map();
  for (const p of roots) props.set(`${p.wrap}|${p.name}`, p);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of roots) {
      if (!needed.has(p.name)) continue;
      for (const v of varsUsed(p.value)) if (!needed.has(v)) (needed.add(v), (grew = true));
    }
  }
  const byWrap = new Map();
  for (const p of roots) {
    if (!needed.has(p.name)) continue;
    const list = byWrap.get(p.wrap) ?? [];
    list.push(p);
    byWrap.set(p.wrap, list);
  }
  const decl = (p, pad) => `${pad}${p.name}: ${p.value.replace(/\s*\n\s*/g, ' ')};`;
  let rootCss = '';
  const plain = byWrap.get('') ?? [];
  if (plain.length > 0) rootCss += `${SCOPE} {\n${plain.map((p) => decl(p, '  ')).join('\n')}\n}\n`;
  for (const [wrap, list] of byWrap) {
    if (wrap === '') continue;
    rootCss += `${wrap} {\n  ${SCOPE} {\n${list.map((p) => decl(p, '    ')).join('\n')}\n  }\n}\n`;
  }

  const body = [rootCss, ...kept.map((n) => emit(n, 0))].filter(Boolean).join('\n');
  const indented = body
    .split('\n')
    .map((l) => (l === '' ? '' : `  ${l}`))
    .join('\n');
  return `/* Generated by tools/vendor-pdfjs-css.mjs from pdfjs-dist ${version} (web/pdf_viewer.css). Do not edit: run \`node tools/vendor-pdfjs-css.mjs\`.\n * Only the rules of the page, canvas, text layer and link layer; every selector is prefixed with ${SCOPE}. Apache-2.0, Mozilla Foundation. */\n@layer pdfjs {\n${indented.trimEnd()}\n}\n`;
}

/** Reads the installed pdf.js and returns the generated sheet. */
export function generateFromInstalled() {
  const pkgPath = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
  const dir = path.dirname(pkgPath);
  const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  return generate(readFileSync(path.join(dir, 'web/pdf_viewer.css'), 'utf8'), version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const css = generateFromInstalled();
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUTPUT, 'utf8');
    } catch {
      // missing
    }
    if (current !== css) {
      console.error('pdfjs-viewer.css is out of date: run `node tools/vendor-pdfjs-css.mjs`.');
      process.exit(1);
    }
    console.log('pdfjs-viewer.css is up to date.');
  } else {
    writeFileSync(OUTPUT, css);
    console.log(`Wrote ${path.relative(root, OUTPUT)} (${(Buffer.byteLength(css) / 1024).toFixed(1)} KiB).`);
  }
}
