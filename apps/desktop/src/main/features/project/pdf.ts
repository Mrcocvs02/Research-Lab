/**
 * A report (Markdown) as a plain PDF: A4, Helvetica, headings in bold, one line per list item, no images. Written by hand so
 * the app needs no PDF library for it; the file is pure ASCII (other characters go out as octal escapes of WinAnsi), so it
 * can be written like any text file.
 */
const W = 595;
const H = 842;
const MARGIN = 56;
const WIN1252: Record<string, number> = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };

/** Average glyph width of Helvetica, in em: good enough to wrap lines (a little short on purpose). */
const AVG = 0.52;
const wrap = (text: string, size: number, width: number): string[] => {
  const max = Math.max(10, Math.floor(width / (size * AVG)));
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > max) {
      if (line) (out.push(line), (line = ''));
      out.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (line && line.length + 1 + w.length > max) (out.push(line), (line = w));
    else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
};

export const escapePdf = (s: string): string => {
  let out = '';
  for (const ch of s) {
    const code = WIN1252[ch] ?? ch.codePointAt(0)!;
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code >= 32 && code < 127) out += ch;
    else if (code < 256) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += '?';
  }
  return out;
};

interface Line {
  text: string;
  size: number;
  bold: boolean;
  gap: number;
}

/** Markdown to lines: `#` headings, list items, `lab://` links reduced to their text, emphasis marks dropped, HTML comments left out. */
export function reportLines(markdown: string): Line[] {
  const lines: Line[] = [];
  const clean = (t: string) =>
    t
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]{1,3}/g, '')
      .trim();
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      const size = h[1]!.length === 1 ? 18 : h[1]!.length === 2 ? 14 : 12;
      for (const [i, text] of wrap(clean(h[2]!), size, W - 2 * MARGIN).entries()) lines.push({ text, size, bold: true, gap: i === 0 ? size * 0.6 : 0 });
      continue;
    }
    const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    const body = clean(li ? li[1]! : raw);
    if (body === '') {
      if (raw.trim() === '') lines.push({ text: '', size: 11, bold: false, gap: 0 });
      continue;
    }
    const ws = wrap(li ? `- ${body}` : body, 11, W - 2 * MARGIN);
    for (const text of ws) lines.push({ text, size: 11, bold: false, gap: 0 });
  }
  return lines;
}

/** The PDF file as a string of ASCII characters. */
export function reportPdf(markdown: string): string {
  const pages: string[] = [];
  let content = '';
  let y = H - MARGIN;
  const flush = () => {
    pages.push(content);
    content = '';
    y = H - MARGIN;
  };
  for (const l of reportLines(markdown)) {
    const lead = l.size * 1.35;
    y -= l.gap;
    if (y - lead < MARGIN) flush();
    y -= lead;
    if (l.text) content += `BT /${l.bold ? 'F2' : 'F1'} ${l.size} Tf ${MARGIN} ${y.toFixed(1)} Td (${escapePdf(l.text)}) Tj ET\n`;
  }
  if (content || pages.length === 0) flush();
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((c, i) => {
    objs[5 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`;
    objs[6 + 2 * i] = `<< /Length ${c.length} >>\nstream\n${c}endstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return `${out}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
