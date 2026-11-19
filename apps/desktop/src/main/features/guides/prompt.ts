import { z } from 'zod';
import { structuredSystem, type Lang } from '@rl/ai/analysis';
import { REFS_LIMITS, type GuidePassage } from '@rl/core';

/**
 * The guide of a paper (experiment 30, D-401, D-425): a few passages worth reading first (contribution, method, result, limit),
 * each a verbatim sentence of one page so that the reader can mark it in the margin. The model answers in a schema; main keeps
 * only the sentences that really are on the page they name. The text of the paper is delimited data, never instructions.
 */
export const GUIDE_VERSION = 'guide-v1';
/** Characters of the paper that go to the model (about 12 000 tokens) and what the dialog says it costs. */
export const GUIDE_TEXT_CHARS = 48_000;
export const GUIDE_PAGES = 80;
export const GUIDE_APPROX_TOKENS = 14_000;

export const guideSchema = z.object({ passages: z.array(z.object({ kind: z.enum(['C', 'M', 'R', 'L']), page: z.number().int().positive(), quote: z.string(), reason: z.string() })) });
export type GuideRaw = z.infer<typeof guideSchema>;

export function guideSystem(language: Lang): string {
  return structuredSystem({
    version: GUIDE_VERSION,
    role: 'You pick the few passages of one research paper that a researcher should read first, so that they can find the contribution, the method, the key result and the limits at a glance.',
    output: `JSON {"passages": [{"kind": "C|M|R|L", "page": <page number>, "quote": "<one sentence copied word for word from that page>", "reason": "<at most 15 words on why it matters>"}]}. "C" contribution, "M" method, "R" result, "L" limit the authors admit. At most ${REFS_LIMITS.passages} passages, at least one "C" and one "R" when the text has them.`,
    rules: ['Copy each "quote" exactly from the TEXT of the data, on the page you name (the data marks each page); never paraphrase it.', 'Never pick a sentence from the bibliography, a heading or a figure caption.'],
    language,
  });
}

const strip = (t: string) => t.replace(/<<<|>>>/g, ' ');
export const guidePrompt = (meta: string, text: string): string => `<<<DATA\n${strip(meta)}\nTEXT:\n${strip(text)}\nDATA>>>\nPick the passages to read first.`;

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[\s-]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim();

/** Keeps the passages whose quote is on the named page, one per sentence, at most the limit, in page order. */
export function cleanGuide(raw: GuideRaw, pages: ReadonlyArray<{ page: number; text: string }>): GuidePassage[] {
  const byPage = new Map(pages.map((p) => [p.page, norm(p.text)]));
  const seen = new Set<string>();
  const kept: Array<Omit<GuidePassage, 'id'>> = [];
  for (const p of raw.passages) {
    const quote = p.quote.replace(/\s+/g, ' ').trim().slice(0, REFS_LIMITS.quote);
    const q = norm(quote);
    if (q.length < 20 || seen.has(q) || !byPage.get(p.page)?.includes(q)) continue;
    seen.add(q);
    kept.push({ kind: p.kind, page: p.page, quote, reason: p.reason.replace(/\s+/g, ' ').trim().slice(0, REFS_LIMITS.reason) });
    if (kept.length >= REFS_LIMITS.passages) break;
  }
  return kept.sort((a, b) => a.page - b.page).map((p, i) => ({ ...p, id: `${p.page}-${i}` }));
}

const KIND: Array<[RegExp, GuidePassage['kind']]> = [
  [/contribut/i, 'C'],
  [/method|metod/i, 'M'],
  [/result|risultat/i, 'R'],
  [/limit/i, 'L'],
];
const LINK = /\[p\.\s*(\d+)\]\(lab:\/\/doc\/[^)]*\)/g;

/** The passages a literature note gives without any request: each section of contribution, method, results and limits, at its first page. */
export function guideFromNote(body: string): GuidePassage[] {
  const out: GuidePassage[] = [];
  let kind: GuidePassage['kind'] | null = null;
  for (const line of body.split(/\r?\n/)) {
    const head = /^#{1,6}\s+(.*)$|^\*\*(.+?)\*\*\s*:?\s*$/.exec(line.trim());
    if (head) {
      kind = KIND.find(([re]) => re.test(head[1] ?? head[2] ?? ''))?.[1] ?? null;
      continue;
    }
    const page = Number(new RegExp(LINK.source).exec(line)?.[1]);
    if (!kind || !page || out.some((p) => p.kind === kind && p.page === page)) continue;
    const reason = line.replace(LINK, '').replace(/[()*_>`-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REFS_LIMITS.reason);
    out.push({ id: `n${out.length}`, kind, page, quote: null, reason });
    if (out.length >= REFS_LIMITS.passages) break;
  }
  return out.sort((a, b) => a.page - b.page);
}
