import { blank, cleanAuthors, cleanList, clip, LIMITS, normArxiv, normDoi, yearOf, type BibEntry, type BibRead } from './entry.js';

interface Raw {
  type: string;
  key: string;
  fields: Map<string, string>;
}

const ACCENTS: Record<string, string> = { '`': '̀', "'": '́', '^': '̂', '~': '̃', '=': '̄', '"': '̈', '.': '̇', u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊' };
const SPECIAL: Record<string, string> = { ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı' };

/** LaTeX text to plain text: accents, escaped characters, protective braces. */
export function unlatex(s: string): string {
  let t = s.replace(/\\([`'^~=".uvHckr])\s*\{\\?([A-Za-z])\}|\\([`'^~=".])\s*\\?([A-Za-z])/g, (_m, a1: string | undefined, l1: string | undefined, a2: string | undefined, l2: string | undefined) => (l1 ?? l2 ?? '') + (ACCENTS[(a1 ?? a2)!] ?? ''));
  t = t.replace(/\\([uvHckr])\s+([A-Za-z])/g, (_m, a: string, l: string) => l + ACCENTS[a]!);
  t = t.replace(/\{?\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i)\}?(?![A-Za-z])/g, (_m, k: string) => SPECIAL[k]!);
  t = t.replace(/\\([&%$#_{}])/g, '$1').replace(/~/g, ' ').replace(/\\textendash|--/g, '–').replace(/\\[a-zA-Z]+\s*/g, '');
  return t.replace(/[{}]/g, '').normalize('NFC');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Reads the raw entries; `@string` macros are expanded, `@comment` and `@preamble` ignored. */
function scan(text: string): Raw[] {
  const out: Raw[] = [];
  const macros = new Map<string, string>(MONTHS.map((m) => [m, m]));
  let i = 0;
  const n = text.length;
  const ws = () => {
    while (i < n && /\s/.test(text[i]!)) i++;
  };
  const braced = (): string => {
    const open = text[i]!;
    const close = open === '{' ? '}' : ')';
    let depth = 0;
    const start = i + 1;
    for (; i < n; i++) {
      const c = text[i]!;
      if (c === '\\') i++;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) return text.slice(start, i++);
    }
    return text.slice(start);
  };
  const quoted = (): string => {
    const start = ++i;
    let depth = 0;
    for (; i < n; i++) {
      const c = text[i]!;
      if (c === '\\') i++;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '"' && depth <= 0) return text.slice(start, i++);
    }
    return text.slice(start);
  };
  /** A value: pieces joined with `#`. */
  const value = (): string => {
    let v = '';
    for (;;) {
      ws();
      const c = text[i];
      if (c === '{') v += braced();
      else if (c === '"') v += quoted();
      else {
        const m = /^[^\s,#{}()="]+/.exec(text.slice(i, i + 80));
        if (!m) break;
        i += m[0].length;
        v += macros.get(m[0].toLowerCase()) ?? m[0];
      }
      ws();
      if (text[i] === '#') i++;
      else break;
    }
    return v;
  };
  while (out.length < LIMITS.entries) {
    const at = text.indexOf('@', i);
    if (at < 0) break;
    i = at + 1;
    const head = /^\s*([A-Za-z]+)\s*([{(])/.exec(text.slice(i, i + 40));
    if (!head) continue;
    const type = head[1]!.toLowerCase();
    i += head[0].length - 1;
    if (type === 'comment' || type === 'preamble') {
      braced();
      continue;
    }
    const close = head[2] === '{' ? '}' : ')';
    if (type === 'string') {
      i++;
      ws();
      const m = /^[^\s=]+/.exec(text.slice(i, i + 80));
      if (m) {
        i += m[0].length;
        ws();
        if (text[i] === '=') {
          i++;
          macros.set(m[0].toLowerCase(), value());
        }
      }
      ws();
      if (text[i] === close) i++;
      continue;
    }
    i++;
    ws();
    const km = /^[^\s,={}]*/.exec(text.slice(i, i + 200))!;
    i += km[0].length;
    const raw: Raw = { type, key: km[0], fields: new Map() };
    for (;;) {
      ws();
      if (i >= n || text[i] === close) {
        i++;
        break;
      }
      if (text[i] === ',') {
        i++;
        continue;
      }
      const f = /^[^\s=,{}]+/.exec(text.slice(i, i + 80));
      if (!f) {
        i++;
        continue;
      }
      i += f[0].length;
      ws();
      if (text[i] !== '=') continue;
      i++;
      raw.fields.set(f[0].toLowerCase(), value());
    }
    out.push(raw);
  }
  return out;
}

const splitAuthors = (s: string): string[] => unlatex(s.replace(/\s+/g, ' ')).split(/\s+and\s+/i);

function toEntry(r: Raw): BibEntry {
  const f = (k: string) => (r.fields.has(k) ? unlatex(r.fields.get(k)!) : null);
  const e = blank();
  e.key = r.key || null;
  e.title = clip(f('title'));
  e.authors = cleanAuthors(splitAuthors(r.fields.get('author') ?? r.fields.get('editor') ?? '').filter(Boolean));
  e.year = yearOf(f('year') ?? f('date'));
  e.venue = clip(f('journal') ?? f('journaltitle') ?? f('booktitle') ?? f('series') ?? f('howpublished'), 500);
  const vol = f('volume');
  const num = f('number') ?? f('issue');
  const pages = f('pages');
  e.venueRef = clip([vol && `vol. ${vol}`, num && `no. ${num}`, pages && `pp. ${pages}`].filter(Boolean).join(', '), 500);
  e.doi = normDoi(f('doi') ?? f('url'));
  const prefix = (f('archiveprefix') ?? f('eprinttype') ?? '').toLowerCase();
  e.arxivId = normArxiv(prefix === 'arxiv' ? f('eprint') : (f('arxiv') ?? (/arxiv/i.test(f('journal') ?? '') ? f('journal') : null)));
  e.tags = cleanList((f('keywords') ?? f('keyword') ?? '').split(/[,;]/));
  e.notes = [f('annote'), f('annotation'), e.doi === null ? f('note') : null].map((x) => clip(x, LIMITS.notes)).filter((x): x is string => x !== null);
  // `file = {Description:path:type;Description:path:type}` (Zotero, JabRef) or a plain path.
  const files = (r.fields.get('file') ?? '').split(';').map((p) => {
    const parts = p.split(':');
    if (parts.length < 3) return (parts[0] ?? '').trim();
    // The last part is a media type, the first a description; a Windows drive letter in between keeps its colon.
    const hasType = /^[a-z]+\/[\w.+-]+$/i.test(parts[parts.length - 1]!);
    return parts.slice(1, hasType ? -1 : undefined).join(':').replace(/\\:/g, ':').trim();
  });
  e.files = files.filter((p) => p !== '' && !p.includes('\0')).slice(0, 20);
  return e;
}

export function readBibtex(text: string, base: string): BibRead {
  const entries: BibEntry[] = [];
  const skipped: BibRead['skipped'] = [];
  for (const r of scan(text)) {
    const e = toEntry(r);
    if (e.title === null && e.authors.length === 0) skipped.push({ label: r.key || r.type, reason: 'empty' });
    else entries.push(e);
  }
  return { source: 'bibtex', entries, base, skipped: skipped.slice(0, 500) };
}
