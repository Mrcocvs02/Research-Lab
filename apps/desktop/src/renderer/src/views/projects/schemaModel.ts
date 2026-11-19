import type { Claim, Outline } from '@rl/core';

/** Pure parts of the Schema tab (X7), kept apart so they are tested without the view. */

export type ClaimState = 'none' | 'disputed' | 'ok';
/** No evidence (a light warning), evidence on both sides ("In discussione"), or evidence on one side. */
export function claimState(c: Claim): ClaimState {
  if (c.evidence.length === 0) return 'none';
  return c.evidence.some((e) => e.stance === 'supports') && c.evidence.some((e) => e.stance === 'contradicts') ? 'disputed' : 'ok';
}

/** The filter "Solo prove": only the claims that have evidence. */
export const visibleClaims = (claims: readonly Claim[], only: boolean): Claim[] => (only ? claims.filter((c) => c.evidence.length > 0) : [...claims]);

export interface QuestionGroup {
  id: string | null;
  /** 0-based position in the outline; null for the claims that answer no (known) question. */
  index: number | null;
  text: string;
  claims: Claim[];
}

/** The claims under their question, in the order of the outline; the rest in a last group. `hideEmpty`: questions without a claim are left out. */
export function claimsByQuestion(outline: Outline | null, claims: readonly Claim[], hideEmpty: boolean): QuestionGroup[] {
  const known = new Set(outline?.questions.map((q) => q.id));
  const groups: QuestionGroup[] = (outline?.questions ?? []).map((q, i) => ({ id: q.id, index: i, text: q.text, claims: claims.filter((c) => c.questionId === q.id) }));
  const rest = claims.filter((c) => c.questionId === null || !known.has(c.questionId));
  if (rest.length > 0) groups.push({ id: null, index: null, text: '', claims: rest });
  return hideEmpty ? groups.filter((g) => g.claims.length > 0) : groups;
}

export interface OutlineDraft {
  idea: string;
  questions: string;
  hypotheses: string;
  plan: string;
}

export const outlineToDraft = (o: Outline | null): OutlineDraft => ({ idea: o?.idea ?? '', questions: o?.questions.map((q) => q.text).join('\n') ?? '', hypotheses: o?.hypotheses.join('\n') ?? '', plan: o?.plan ?? '' });

const nonEmpty = (v: string): string[] => v.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const newQuestionId = (used: ReadonlySet<string>): string => {
  for (;;) {
    const id = `q${Math.random().toString(36).slice(2, 7)}`;
    if (!used.has(id)) return id;
  }
};

/**
 * The outline from the four boxes. A line equal to an old question keeps its id; a line that is new takes the id of an old
 * question that no line matches, in order (the question was reworded: its claims stay with it); otherwise a new id.
 */
export function draftToOutline(d: OutlineDraft, prev: Outline | null): Outline {
  const old = prev?.questions ?? [];
  const lines = nonEmpty(d.questions).slice(0, 30);
  const matched = new Set<string>();
  const byText = lines.map((l) => old.find((q) => q.text === l && !matched.has(q.id)));
  byText.forEach((q) => q && matched.add(q.id));
  const spare = old.filter((q) => !matched.has(q.id));
  const used = new Set(old.map((q) => q.id));
  const questions = lines.map((text, i) => {
    const hit = byText[i] ?? spare.shift();
    if (hit) return { id: hit.id, text, sources: hit.sources };
    const id = newQuestionId(used);
    used.add(id);
    return { id, text, sources: [] };
  });
  return { idea: d.idea.trim(), questions, hypotheses: nonEmpty(d.hypotheses).slice(0, 30), plan: d.plan.trim() };
}

/** The paragraphs of a note (blocks between blank lines) that are text, with whether they already cite something. */
export interface NoteParagraph {
  index: number;
  text: string;
  cited: boolean;
}
const CITED = /\\cite[a-z]*\{|\[@[^\]]+\]|\]\(lab:\/\/doc\//;
export function noteParagraphs(notes: string): NoteParagraph[] {
  const out: NoteParagraph[] = [];
  let inFence = false;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    buf = [];
    // Headings, lists of links, tables and formulas are not paragraphs to cover; at least a sentence of words is needed.
    if (text.length >= 40 && !/^(#|\||\$\$|>)/.test(text) && /[\p{L}]{3,}\s+[\p{L}]{2,}/u.test(text)) out.push({ index: out.length, text: text.slice(0, 3000), cited: CITED.test(text) });
  };
  for (const line of notes.replace(/\r/g, '').split('\n')) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      flush();
    } else if (inFence) continue;
    else if (line.trim() === '') flush();
    else buf.push(line);
  }
  flush();
  return out;
}

/** What goes on the clipboard for "Copia la chiave": LaTeX or Pandoc. */
export const citeSnippet = (key: string, style: 'latex' | 'pandoc'): string => (style === 'latex' ? `\\cite{${key}}` : `[@${key}]`);

/** The base name of an exported report: `report-<date>` (the date is already `AAAA-MM-GG`; anything else is dropped). */
export const reportFileName = (date: string): string => `report-${/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : 'draft'}`;
