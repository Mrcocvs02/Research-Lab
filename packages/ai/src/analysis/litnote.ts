import { clip, tokenize } from './text.js';

/** A top-level section of a document (a chapter of a thesis, a numbered or named section of a paper). */
export interface Section {
  title: string;
  text: string;
  pageStart: number;
  pageEnd: number;
  /** The reference list: kept out of the note (it is not content), never counted as a lost section. */
  skip: boolean;
}

const NAMED = 'abstract|summary|introduction|background|related work|preliminaries|methods?|methodology|results?|discussion|conclusions?|conclusion and outlook|conclusions and outlook|outlook|perspectives|future work|references|bibliography|acknowledg\\w+|appendix(?:es)?(?: [a-z0-9])?|riassunto|sommario|introduzione|conclusioni|bibliografia|ringraziamenti|appendice|prefazione|preface';
/** A heading: "Chapter 3 ...", "3 Results", or a well-known name alone on the line. Sub-numbers (3.1) stay in their section. */
const HEADING = new RegExp(`^(?:(?:chapter|chapitre|capitolo|part|parte)\\s+(?:\\d+|[ivxl]+)\\b[.:]?\\s*.{0,80}|\\d{1,2}[.)]?\\s+\\p{Lu}[^\\n]{2,80}|(?:[ivx]{1,4}\\.\\s+)?(?:${NAMED})[:.]?)$`, 'iu');
const REFERENCES = /^(?:references|bibliography|bibliografia|riferimenti)\b/i;
const CONCLUSION = /^(?:\d{1,2}[.)]?\s+|chapter \d+[.:]?\s*|capitolo \d+[.:]?\s*)?(?:conclusions?|concluding|conclusioni|summary and outlook|outlook|perspectives|future work)\b/i;

const isHeading = (l: string) => l.length >= 3 && l.length <= 90 && HEADING.test(l) && !/[,;]$/.test(l) && !/^\d+(?:\.\d+)+\s/.test(l);

/** Splits the pages into sections at the top-level headings. Text before the first heading is the "Front matter". Bounded work. */
export function splitSections(pages: ReadonlyArray<{ page: number; text: string }>): Section[] {
  const out: Section[] = [];
  let cur: Section = { title: 'Front matter', text: '', pageStart: pages[0]?.page ?? 1, pageEnd: pages[0]?.page ?? 1, skip: false };
  const push = () => {
    if (cur.text.trim() || cur.title !== 'Front matter') out.push({ ...cur, text: cur.text.trim() });
  };
  for (const p of pages) {
    for (const raw of p.text.split('\n', 4000)) {
      const line = raw.trim();
      if (isHeading(line)) {
        push();
        cur = { title: line, text: '', pageStart: p.page, pageEnd: p.page, skip: REFERENCES.test(line.replace(/^\d+[.)]?\s+/, '')) };
      } else cur.text += `${raw}\n`;
    }
    cur.pageEnd = p.page;
  }
  push();
  // A table of contents repeats the headings with no text between them: sections with (almost) no text are merged into the next one.
  const merged: Section[] = [];
  let carry = '';
  for (const s of out) {
    if (!s.skip && s.text.length < 80 && s !== out[out.length - 1] && s.title !== 'Front matter') {
      carry += `${s.title}\n`;
      continue;
    }
    merged.push(carry ? { ...s, text: `${carry}${s.text}` } : s);
    carry = '';
  }
  if (carry) merged.push({ title: 'Contents', text: carry, pageStart: 1, pageEnd: 1, skip: false });
  return merged;
}

/** The sections that carry content (the reference list is left out). */
export const contentSections = (s: readonly Section[]): Section[] => s.filter((x) => !x.skip && x.text.trim().length > 0);

/** The final chapter: the last conclusions/outlook section, else the last content section that is not an appendix or the acknowledgements. */
export function finalSection(sections: readonly Section[]): Section | null {
  const c = contentSections(sections).filter((x) => !/^(?:appendix|appendice|acknowledg|ringraziamenti)/i.test(x.title.replace(/^\d+[.)]?\s+/, '')));
  return [...c].reverse().find((x) => CONCLUSION.test(x.title)) ?? c[c.length - 1] ?? null;
}

export const NOTE_LIMITS = { singleCallChars: 60_000, chapterChars: 24_000, maxChapters: 24, minSectionChars: 600, finalChars: 12_000 } as const;

/**
 * How a document is summarised: `single` (one call with every section, shrunk to fit and always with its final chapter) or
 * `chapters` (a long document such as a thesis: one summary call per chapter group, then one call that writes the note from the
 * summaries). Groups keep the order and are at most `maxChapters`.
 */
export function planNote(sections: readonly Section[], o: { singleCallChars?: number; chapterChars?: number; maxChapters?: number } = {}): { mode: 'single' | 'chapters'; groups: Section[][] } {
  const secs = contentSections(sections);
  const total = secs.reduce((a, s) => a + s.text.length, 0);
  if (total <= (o.singleCallChars ?? NOTE_LIMITS.singleCallChars)) return { mode: 'single', groups: [secs] };
  const cap = o.chapterChars ?? NOTE_LIMITS.chapterChars;
  const maxN = o.maxChapters ?? NOTE_LIMITS.maxChapters;
  const groups: Section[][] = [];
  for (const s of secs) {
    const last = groups[groups.length - 1];
    const chapterStart = /^(?:chapter|chapitre|capitolo)\b/i.test(s.title);
    const size = last?.reduce((a, x) => a + x.text.length, 0) ?? 0;
    if (last && !chapterStart && size + s.text.length <= cap) last.push(s);
    else groups.push([s]);
  }
  // Too many groups: merge the smallest neighbouring pair until the cap is met.
  while (groups.length > maxN) {
    let at = 0;
    let min = Infinity;
    for (let i = 0; i + 1 < groups.length; i++) {
      const n = groups[i]!.reduce((a, x) => a + x.text.length, 0) + groups[i + 1]!.reduce((a, x) => a + x.text.length, 0);
      if (n < min) [min, at] = [n, i];
    }
    groups.splice(at, 2, [...groups[at]!, ...groups[at + 1]!]);
  }
  return { mode: 'chapters', groups };
}

const strip = (t: string) => t.replace(/<<<|>>>/g, ' ');

/**
 * The sections as one text of at most `budget` characters. Every section keeps a share (never less than 600 characters, or all of it
 * when shorter); the final chapter is taken in full up to 12000 characters before the others are shrunk, so the end of the work
 * is never what gets cut. A shrunk section keeps its beginning and its end.
 */
export function fitSections(sections: readonly Section[], budget: number): string {
  const secs = contentSections(sections);
  const fin = finalSection(secs);
  const finalLen = fin ? Math.min(fin.text.length, NOTE_LIMITS.finalChars) : 0;
  const rest = secs.filter((s) => s !== fin);
  const restTotal = rest.reduce((a, s) => a + s.text.length, 0);
  const room = Math.max(0, budget - finalLen);
  const ratio = restTotal <= room ? 1 : room / restTotal;
  const render = (s: Section, limit: number) => {
    const t = strip(s.text.trim());
    const body = t.length <= limit ? t : `${t.slice(0, Math.floor(limit * 0.7))}\n[...]\n${t.slice(t.length - Math.floor(limit * 0.3))}`;
    return `## ${strip(s.title)} (pages ${s.pageStart}-${s.pageEnd})\n${body}`;
  };
  return secs
    .map((s) => (s === fin ? render(s, finalLen) : render(s, ratio === 1 ? s.text.length : Math.max(NOTE_LIMITS.minSectionChars, Math.floor(s.text.length * ratio)))))
    .join('\n\n');
}

const headingsOf = (note: string): string[][] => note.split('\n').filter((l) => /^\s{0,3}(?:#{1,6}\s|\*\*)/.test(l)).map((l) => tokenize(l));

/** Sections of the document whose title does not appear (by its words) in a heading of the note: the note must lose none. */
export function missingSections(note: string, sections: readonly Section[]): Section[] {
  const heads = headingsOf(note);
  const bodyTokens = new Set(tokenize(note));
  return contentSections(sections).filter((s) => {
    if (s.title === 'Front matter' || s.title === 'Contents') return false;
    const want = tokenize(s.title.replace(/^(?:chapter|capitolo|chapitre|part|parte)?\s*\d+[.)]?\s*/i, ''));
    if (want.length === 0) return false;
    const hit = heads.some((h) => want.filter((w) => h.includes(w)).length / want.length >= 0.6);
    // The title may be generic ("Results"): a heading is enough, but a title missing from every heading and from the text is lost.
    return !hit && !want.every((w) => bodyTokens.has(w));
  });
}

/**
 * The note with a short extractive entry for every section it lost (and for the final chapter when it is not the last heading),
 * so that "no section lost" and "always the final chapter" hold whatever the model wrote. The entries are marked.
 */
export function completeNote(note: string, sections: readonly Section[]): { note: string; added: string[] } {
  const lost = missingSections(note, sections);
  const fin = finalSection(sections);
  const out = lost.filter((s) => s !== fin);
  const finalMissing = fin && lost.includes(fin);
  const entry = (s: Section) => `\n\n## ${strip(s.title)}\n_(not summarised by the model; start of the section)_ ${clip(strip(s.text).replace(/\s+/g, ' '), 500)}`;
  const body = note.trimEnd() + out.map(entry).join('') + (finalMissing && fin ? entry(fin) : '');
  return { note: `${body}\n`, added: [...out, ...(finalMissing && fin ? [fin] : [])].map((s) => s.title) };
}
