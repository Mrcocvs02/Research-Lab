import { createHash } from 'node:crypto';
import { MANUSCRIPT_LIMITS } from '@rl/core';

/** A heading read from the manuscript file: the text and the level (1-4, deeper ones count as 4). */
export interface Heading {
  title: string;
  level: number;
}

const clean = (t: string): string => t.replace(/\s+/g, ' ').trim().slice(0, MANUSCRIPT_LIMITS.title);
const clamp = (n: number): number => Math.min(4, Math.max(1, n));

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeEntities = (s: string): string =>
  s.replace(/&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g, (_m, d: string | undefined, h: string | undefined, n: string | undefined) => {
    if (n) return ENTITIES[n]!;
    const cp = d ? Number(d) : parseInt(h!, 16);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  });

/** Stable fingerprint of the structure (levels and titles) of a manuscript. */
export const headingsHash = (hs: Heading[]): string => createHash('sha1').update(hs.map((h) => `${h.level}\t${h.title}`).join('\n')).digest('hex').slice(0, 16);

/* -------------------------------- Markdown -------------------------------- */

const plainMd = (t: string): string =>
  t
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');

/** ATX (`#`...) and setext (underlined) headings; front matter and fenced code blocks are skipped. */
export function parseMarkdown(text: string): Heading[] {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const out: Heading[] = [];
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && (l.trim() === '---' || l.trim() === '...'));
    if (end > 0) i = end + 1;
  }
  let fence: { ch: string; len: number } | null = null;
  let prevText = false; // the previous line is plain paragraph text (a candidate setext heading)
  let prev = '';
  for (; i < lines.length && out.length < MANUSCRIPT_LIMITS.sections; i++) {
    const line = lines[i]!;
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1]![0] === fence.ch && f[1]!.length >= fence.len && line.trim() === f[1]) fence = null;
      prevText = false;
      continue;
    }
    if (f) {
      fence = { ch: f[1]![0]!, len: f[1]!.length };
      prevText = false;
      continue;
    }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) {
      const title = clean(plainMd(atx[2] ?? ''));
      if (title) out.push({ title, level: clamp(atx[1]!.length) });
      prevText = false;
      continue;
    }
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
    if (setext && prevText) {
      const title = clean(plainMd(prev));
      if (title) out.push({ title, level: setext[1]![0] === '=' ? 1 : 2 });
      prevText = false;
      continue;
    }
    prevText = line.trim() !== '' && !/^ {4}/.test(line) && !/^ {0,3}(?:[-*+] |\d+[.)] |>|\||<)/.test(line);
    prev = line;
  }
  return out;
}

/* ---------------------------------- LaTeX ---------------------------------- */

const SECTION_CMDS = ['part', 'chapter', 'section', 'subsection', 'subsubsection'] as const;
export const TEX_LIMITS = { depth: 3, files: 50, bytes: 4 * 1024 * 1024 } as const;

/** Removes `%` comments (an escaped `\%` stays) and verbatim blocks. */
function stripTex(src: string): string {
  const noVerb = src.replace(/\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}/g, '');
  return noVerb
    .split(/\r\n|\r|\n/)
    .map((l) => {
      for (let i = 0; i < l.length; i++) {
        if (l[i] !== '%') continue;
        let b = 0;
        for (let j = i - 1; j >= 0 && l[j] === '\\'; j--) b++;
        if (b % 2 === 0) return l.slice(0, i);
      }
      return l;
    })
    .join('\n');
}

/** The `{...}` group (balanced) starting at or after `i`, with an optional `[...]` before it. */
function group(text: string, i: number): { body: string; end: number } | null {
  let p = i;
  const skip = () => {
    while (p < text.length && /\s/.test(text[p]!)) p++;
  };
  skip();
  if (text[p] === '[') {
    const close = text.indexOf(']', p);
    if (close < 0 || close - p > 400) return null;
    p = close + 1;
    skip();
  }
  if (text[p] !== '{') return null;
  let depth = 0;
  const start = p + 1;
  for (; p < text.length && p - start < 3000; p++) {
    const c = text[p];
    if (c === '\\') p++;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { body: text.slice(start, p), end: p + 1 };
  }
  return null;
}

/** A title written with commands, reduced to its text (`\emph{x}` is x). */
export function texPlain(t: string): string {
  let s = t.replace(/\\(?:label|footnote|thanks|index|cite[a-z]*)\*?(?:\[[^\]]*\])?\{[^{}]*\}/g, '');
  for (let k = 0; k < 6; k++) {
    const n = s.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])*\{([^{}]*)\}/g, '$1');
    if (n === s) break;
    s = n;
  }
  return clean(
    s
      .replace(/\\\\/g, ' ')
      .replace(/\\([&%_#$])/g, '$1')
      .replace(/\\[a-zA-Z]+\*?/g, ' ')
      .replace(/~/g, ' ')
      .replace(/[{}$]/g, ''),
  );
}

export interface TexResult {
  headings: Heading[];
  read: { files: number; total: number };
}
export interface TexIo {
  /** Contents of a file, or null when it cannot be read; the path comes from `resolve`. */
  read(path: string): Promise<string | null>;
  /** Resolves an include target to a path inside the folder of the chosen file (symbolic links followed), or null. */
  resolve(target: string): Promise<string | null>;
}

/** Headings of a `.tex` file and of what it includes (`\input`, `\include`, `\subfile`), within the limits of `TEX_LIMITS`. */
export async function parseLatex(main: string, io: TexIo, mainPath: string): Promise<TexResult> {
  const raw: Array<{ kind: number; title: string }> = [];
  const seen = new Set<string>([mainPath]);
  let bytes = main.length;
  let files = 1;
  let total = 1;
  const walk = async (src: string, depth: number, isMain: boolean): Promise<void> => {
    let text = stripTex(src);
    if (isMain) {
      const at = text.indexOf('\\begin{document}');
      if (at >= 0) text = text.slice(at);
    }
    const re = /\\(part|chapter|section|subsection|subsubsection)\*?(?![a-zA-Z])|\\(input|include|subfile)(?![a-zA-Z])/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const g = group(text, m.index + m[0].length);
      if (!g) continue;
      re.lastIndex = g.end;
      if (m[1]) {
        const title = texPlain(g.body);
        if (title && raw.length < MANUSCRIPT_LIMITS.sections) raw.push({ kind: SECTION_CMDS.indexOf(m[1] as (typeof SECTION_CMDS)[number]), title });
        continue;
      }
      const target = g.body.trim();
      if (!target || target.includes('\0')) continue;
      const file = await io.resolve(/\.[A-Za-z0-9]{1,5}$/.test(target) ? target : `${target}.tex`);
      if (!file || seen.has(file)) continue;
      seen.add(file);
      total++;
      if (depth >= TEX_LIMITS.depth || files >= TEX_LIMITS.files) continue;
      const sub = await io.read(file);
      if (sub === null) {
        total--;
        continue;
      }
      if (bytes + sub.length > TEX_LIMITS.bytes) continue;
      bytes += sub.length;
      files++;
      await walk(sub, depth + 1, false);
    }
  };
  await walk(main, 0, true);
  // Levels follow the commands the document really uses, from the outermost: an article (section...) starts at 1, a book (chapter...) too.
  const used = [...new Set(raw.map((r) => r.kind))].sort((a, b) => a - b);
  return { headings: raw.map((r) => ({ title: r.title, level: clamp(used.indexOf(r.kind) + 1) })), read: { files, total } };
}

/* ----------------------------------- DOCX ----------------------------------- */

export const DOCX_LIMITS = { document: 32 * 1024 * 1024, styles: 8 * 1024 * 1024, entries: 2000, total: 128 * 1024 * 1024 } as const;
const HEADING_NAME = /^(?:heading|titolo|titre|t[ií]tulo|[uü]berschrift|ueberschrift|encabezado|rubrik|kop)\s*(\d)$/i;

/** Value of `attr` in the first `<tag ...>` of `xml` (an index scan; the XML is not parsed as a tree). */
function tagAttr(xml: string, tag: string, attr: string): string | undefined {
  const open = `<${tag}`;
  for (let i = xml.indexOf(open); i >= 0; i = xml.indexOf(open, i + 1)) {
    const c = xml[i + open.length];
    if (c !== ' ' && c !== '/' && c !== '>' && c !== '\t' && c !== '\n' && c !== '\r') continue;
    const gt = xml.indexOf('>', i);
    if (gt < 0) return undefined;
    const m = new RegExp(`${attr}="([^"]*)"`).exec(xml.slice(i, gt));
    return m ? decodeEntities(m[1]!) : undefined;
  }
  return undefined;
}

interface StyleInfo {
  name?: string | undefined;
  basedOn?: string | undefined;
  outline?: number | undefined;
}

function readStyles(xml: string): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  for (let i = xml.indexOf('<w:style '); i >= 0; i = xml.indexOf('<w:style ', i + 1)) {
    const end = xml.indexOf('</w:style>', i);
    if (end < 0) break;
    const block = xml.slice(i, end);
    const id = tagAttr(block, 'w:style', 'w:styleId');
    if (!id) continue;
    const o = Number(tagAttr(block, 'w:outlineLvl', 'w:val'));
    map.set(id, { name: tagAttr(block, 'w:name', 'w:val'), basedOn: tagAttr(block, 'w:basedOn', 'w:val'), outline: Number.isFinite(o) ? o : undefined });
  }
  return map;
}

/** Outline level (0-8) of a style, following `basedOn`; a heading name ("Heading 2", "Titolo 2") counts when no level is given. */
function styleLevel(id: string, styles: Map<string, StyleInfo>): number | undefined {
  for (let cur: string | undefined = id, k = 0; cur && k < 10; k++) {
    const st = styles.get(cur);
    if (st?.outline !== undefined) return st.outline <= 8 ? st.outline : undefined;
    cur = st?.basedOn;
  }
  for (let cur: string | undefined = id, k = 0; cur && k < 10; k++) {
    const st = styles.get(cur);
    const n = HEADING_NAME.exec(st?.name ?? '')?.[1] ?? HEADING_NAME.exec(cur)?.[1];
    if (n) return Number(n) - 1;
    cur = st?.basedOn;
  }
  return undefined;
}

function paragraphText(p: string): string {
  let out = '';
  for (let i = p.indexOf('<w:t'); i >= 0; i = p.indexOf('<w:t', i + 1)) {
    const c = p[i + 4];
    if (c !== '>' && c !== ' ') continue; // `<w:tab/>`, `<w:tc>`, `<w:tbl>`: not text
    const gt = p.indexOf('>', i);
    if (gt < 0) break;
    if (p[gt - 1] === '/') continue;
    const end = p.indexOf('</w:t>', gt);
    if (end < 0) break;
    out += decodeEntities(p.slice(gt + 1, end));
  }
  return out;
}

/** Headings of the XML of a `.docx` (`document.xml`, with `styles.xml` when there is one). */
export function parseDocxXml(documentXml: string, stylesXml: string): Heading[] {
  const styles = readStyles(stylesXml);
  const out: Heading[] = [];
  for (let i = documentXml.indexOf('<w:p'); i >= 0 && out.length < MANUSCRIPT_LIMITS.sections; i = documentXml.indexOf('<w:p', i + 1)) {
    const c = documentXml[i + 4];
    if (c !== '>' && c !== ' ') continue;
    const end = documentXml.indexOf('</w:p>', i);
    if (end < 0) break;
    const p = documentXml.slice(i, end);
    const ppr0 = p.indexOf('<w:pPr>');
    const ppr = ppr0 >= 0 ? p.slice(ppr0, Math.max(ppr0, p.indexOf('</w:pPr>', ppr0))) : '';
    let lvl: number | undefined;
    const ownRaw = ppr ? tagAttr(ppr, 'w:outlineLvl', 'w:val') : undefined;
    if (ownRaw !== undefined && Number.isFinite(Number(ownRaw))) lvl = Number(ownRaw) <= 8 ? Number(ownRaw) : undefined;
    else {
      const sid = ppr ? tagAttr(ppr, 'w:pStyle', 'w:val') : undefined;
      if (sid) lvl = styleLevel(sid, styles);
    }
    if (lvl === undefined) continue;
    const title = clean(paragraphText(p));
    if (title) out.push({ title, level: clamp(lvl + 1) });
  }
  return out;
}
