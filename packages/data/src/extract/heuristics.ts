/** Heuristics for title, authors, year and abstract. They only guess; nothing here is verified or interpreted. */

export interface TextLine {
  text: string;
  /** Font size in points (0 when unknown). */
  size: number;
}

const MAX_TITLE = 300;
const NAME_PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'di', 'da', 'del', 'della', 'la', 'le', 'bin', 'al', 'dos', 'du', 'ter', 'ten', 'el']);

export const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** PDF info titles are often a file name or a template placeholder. */
export function plausibleTitle(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const t = squash(raw.replace(/\0/g, ''));
  if (t.length < 4 || t.length > 400) return undefined;
  if (/^(untitled|microsoft word|document\s*\d*$|title$|slide\s*\d+|presentation\d*$|nuovo documento|new document)/i.test(t)) return undefined;
  if (/\.(pdf|docx?|tex|dvi|ps|indd|pptx?|rtf|odt|qxd|cdr|pmd|eps)$/i.test(t)) return undefined;
  if (!/\p{L}{3}/u.test(t)) return undefined;
  if (/^[\w.-]+$/.test(t) && /[_]|\d{3}/.test(t) && !/\s/.test(t)) return undefined; // looks like a file name
  return t;
}

const AFFILIATION = /\b(universit|institut|department|dept\.?|school|laborator|lab\b|college|faculty|centre|center|research|corporation|inc\.?|ltd|gmbh|google|microsoft|meta\b|openai|deepmind|ibm|amazon|apple|nvidia|cnrs|inria|mit\b|eth\b|epfl|politecnico|dipartimento|università|universität|université|academy|hospital|foundation|e-?mail|@|http|www\.)/i;
const NAME_TOKEN = /^(?:\p{Lu}[\p{L}'’-]*\.?|\p{Lu}\.(?:-?\p{Lu}\.)*)$/u;

/** A person-like name: 2 to 5 tokens, capitalised (initials allowed), optional lower-case particles. */
export function looksLikeName(s: string): boolean {
  const t = squash(s);
  if (t.length < 4 || t.length > 60) return false;
  const tokens = t.split(' ');
  if (tokens.length < 2 || tokens.length > 5) return false;
  let caps = 0;
  for (const [i, tok] of tokens.entries()) {
    if (NAME_TOKEN.test(tok)) caps++;
    else if (i > 0 && i < tokens.length - 1 && NAME_PARTICLES.has(tok.toLowerCase())) continue;
    else return false;
  }
  if (caps < 2) return false;
  return !/\d/.test(t) && !AFFILIATION.test(t);
}

const SPLIT_AUTHORS = /\s*(?:,|;|\band\b|\be\b|\bet\b|&|·|•|\s{3,})\s*/u;
const MARKS = /[∗*†‡§¶#¹²³⁰-⁹₀-₉]|\d+/gu;

/** Splits a "A, B and C" line into names, or returns [] if the line does not look like a list of people. */
export function parseAuthorLine(line: string): string[] {
  if (line.length > 250 || AFFILIATION.test(line)) return [];
  const cleaned = line.replace(MARKS, ' ');
  const pieces = cleaned
    .split(SPLIT_AUTHORS)
    .map(squash)
    .filter(Boolean);
  if (pieces.length === 0) return [];
  const names = pieces.filter(looksLikeName);
  return names.length >= 1 && names.length / pieces.length >= 0.6 ? names : [];
}

/** PDF info `Author`: accepted only when it parses as people ("A; B", "A and B", "A, B"). */
export function authorsFromInfo(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const names = parseAuthorLine(raw.replace(/\0/g, ''));
  return names;
}

/** Title lines: the largest text of the first page, if clearly larger than the body. Returns also where it ended. */
export function titleFromFirstPage(lines: TextLine[]): { title: string; endIndex: number } | undefined {
  const usable = lines.map((l, i) => ({ ...l, i, text: squash(l.text) })).filter((l) => l.text.length > 0 && l.size > 0);
  if (usable.length < 2) return undefined;
  const noise = (t: string) => /^(arxiv\s*:|doi\s*:|https?:|www\.|page\s+\d|\d+$)/i.test(t) || !/\p{L}{3}/u.test(t) || /^(abstract|keywords?|contents?|introduction|riassunto|sommario)\b/i.test(t);
  const candidates = usable.filter((l) => !noise(l.text));
  if (candidates.length === 0) return undefined;
  const sizes = [...usable.map((l) => l.size)].sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] as number;
  let max = 0;
  for (const c of candidates) if (c.size > max) max = c.size;
  if (max < median * 1.15) return undefined; // nothing stands out: do not guess
  const first = candidates.find((c) => c.size >= max * 0.95);
  if (!first) return undefined;
  const parts = [first.text];
  let end = first.i;
  for (let i = first.i + 1; i < lines.length && parts.length < 4; i++) {
    const l = usable.find((u) => u.i === i);
    if (!l) continue;
    if (l.size < max * 0.9 || l.size > max * 1.1 || noise(l.text)) break;
    parts.push(l.text);
    end = i;
  }
  let title = squash(parts.join(' ').replace(/(\p{L})- (\p{Ll})/gu, '$1$2'));
  if (title.length > MAX_TITLE) title = title.slice(0, MAX_TITLE).trim();
  return title.length >= 4 ? { title, endIndex: end } : undefined;
}

const ROLE = /\b(prof(?:essor|\.)?|dr\.?|supervisors?|co-?supervisors?|relatore|correlatore|relatrice|advisors?|advisers?|examiner|tutor|chiar\.?mo|ing\.)(?=\W|$)/i;
const ROLE_ONLY = /^(?:(?:co-?)?supervisors?|relatore|correlatore|relatrice|advisors?|advisers?|examiner|tutor)\s*:?$/i;
const CANDIDATE = /^(?:defended by|presented by|submitted by|written by|presentata da|presentato da|candidat[eoa]|author|autore|autrice)\s*:?\s*(.*)$/i;

/**
 * Authors: the first lines after the title that parse as names, before the abstract.
 * On a thesis title page the candidate (after "Candidate", "Defended by", "Candidato"...) wins and role lines
 * (supervisor, advisor, "Prof.") are never taken as authors.
 */
export function authorsFromFirstPage(lines: TextLine[], afterIndex: number): string[] {
  const out: string[] = [];
  let tried = 0;
  let skipNext = false;
  let candidateNext = false;
  for (let i = afterIndex + 1; i < lines.length && tried < 12; i++) {
    const t = squash((lines[i] as TextLine).text);
    if (!t) continue;
    if (/^(abstract|riassunto|sommario|keywords?|introduction|1[.\s]+introduction)\b/i.test(t)) break;
    tried++;
    if (candidateNext) {
      candidateNext = false;
      const names = parseAuthorLine(t);
      if (names.length > 0) return names;
    }
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const cand = CANDIDATE.exec(t);
    if (cand) {
      const names = cand[1] ? parseAuthorLine(cand[1]) : [];
      if (names.length > 0) return names;
      if (!cand[1]) candidateNext = true;
      continue;
    }
    if (ROLE_ONLY.test(t)) {
      skipNext = true;
      continue;
    }
    if (ROLE.test(t)) continue;
    const names = parseAuthorLine(t);
    if (names.length > 0) out.push(...names);
    else if (out.length > 0) break; // the author block is over
  }
  return [...new Set(out)].slice(0, 50);
}

const YEAR = /\b(19[5-9]\d|20[0-3]\d)\b/g;

/** Year: copyright/publication phrases first, then the most common plausible year of the first page. */
export function yearFromText(firstPage: string, nowYear = new Date().getFullYear() + 1): number | undefined {
  const ok = (y: number) => y >= 1950 && y <= nowYear;
  const labelled = /(?:©|\(c\)|copyright|published|accepted|received|submitted|publication date|pubblicato|proceedings of)[^\n]{0,60}?\b(19[5-9]\d|20[0-3]\d)\b/gi;
  for (const m of firstPage.matchAll(labelled)) {
    const y = Number(m[1]);
    if (ok(y)) return y;
  }
  const counts = new Map<number, number>();
  for (const m of firstPage.matchAll(YEAR)) {
    const y = Number(m[1]);
    if (ok(y)) counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  let best: number | undefined;
  let bestN = 0;
  for (const [y, n] of counts) if (n > bestN || (n === bestN && best !== undefined && y > best)) [best, bestN] = [y, n];
  return best;
}

/** Year of a PDF date string (`D:20240115100000Z`) or ISO date. */
export function yearFromDate(raw: string | undefined | null): number | undefined {
  const m = /^(?:D:)?(\d{4})/.exec(raw ?? '');
  if (!m) return undefined;
  const y = Number(m[1]);
  return y >= 1950 && y <= new Date().getFullYear() + 1 ? y : undefined;
}

const MAX_ABSTRACT_SEARCH = 200_000;
const ABSTRACT_START = /(?:^|\n)[ \t]*(?:abstract|riassunto|sommario|résumé|zusammenfassung)[ \t]*[:.—–-]*[ \t]*/i;
const ABSTRACT_END = /\n[ \t]*(?:keywords?|key words|index terms|parole chiave|mots[- ]clés|ccs concepts|(?:1|i)[.\s]+(?:introduction|introduzione)|introduction|introduzione)\b/i;

const INTRO_LINE = /^[ \t]*(?:(?:1|i)[.\s]+)?(?:introduction|introduzione)\b/i;
const NOT_ABSTRACT = /@|\(dated|^\s*(?:received|accepted|published|arxiv|doi|pacs|keywords?)\b|https?:|www\./i;

/**
 * Papers without an "Abstract" heading (APS/arXiv style): the paragraph just above the first "Introduction" line,
 * read backwards until an affiliation, author, date or short heading-like line. Bounded, and never an affiliation.
 */
function unlabelledAbstract(text: string, maxChars: number): string | undefined {
  const lines = text.split('\n', 400);
  const intro = lines.findIndex((l) => INTRO_LINE.test(l) && l.trim().length < 40);
  if (intro < 1) return undefined;
  const parts: string[] = [];
  for (let i = intro - 1; i >= 0; i--) {
    const l = squash(lines[i] as string);
    if (!l) continue;
    const isLast = parts.length === 0;
    if (AFFILIATION.test(l) || NOT_ABSTRACT.test(l) || parseAuthorLine(l).length > 0 || (!isLast && l.length < 35)) break;
    parts.unshift(l);
  }
  const clean = parts.join(' ').replace(/(\p{L})- (\p{Ll})/gu, '$1$2');
  if (clean.length < 150) return undefined;
  return clean.length > maxChars ? clean.slice(0, maxChars).trim() : clean;
}

/** The abstract, when an "Abstract" heading is found in the given text (first pages). */
export function abstractFromText(text: string, maxChars = 3000): string | undefined {
  text = text.slice(0, MAX_ABSTRACT_SEARCH); // the abstract is at the start; the bound keeps the scans cheap on hostile text
  const start = ABSTRACT_START.exec(text);
  if (!start) return unlabelledAbstract(text, maxChars);
  let rest = text.slice(start.index + start[0].length);
  const end = ABSTRACT_END.exec(rest);
  if (end) rest = rest.slice(0, end.index);
  rest = rest.slice(0, maxChars + 200);
  const clean = squash(rest.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2'));
  if (clean.length < 40) return undefined;
  return clean.length > maxChars ? clean.slice(0, maxChars).trim() : clean;
}
