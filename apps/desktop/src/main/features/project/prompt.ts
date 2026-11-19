import { z } from 'zod';
import { structuredSystem, type Lang } from '@rl/ai/analysis';

/**
 * The versioned prompts of the project (X7, D-440, D-423): the report for the advisor or the reading group, and the reordering of
 * citation candidates for one paragraph. Both are built on `structuredSystem` (role, output format with schema, rules on
 * sources and links, language). The model sees only what the task needs: for the report, the outline, the notes and the
 * activity of the period; for the citations, ONE paragraph and at most ten candidates. It never writes a link: it cites by the
 * short marker it was given (`[R1]`, `C1`) and main turns the marker into the link.
 */
export const REPORT_VERSION = 'project-report-v1';
export const CITE_VERSION = 'project-cite-v1';

export const reportSchema = z.object({ markdown: z.string() });
export const citeSchema = z.object({ ranking: z.array(z.object({ id: z.string(), reason: z.string() })) });

/** Characters of context a report may carry (about 6 000 tokens, §17.4.14). */
export const REPORT_CONTEXT_CHARS = 24_000;
export const REPORT_OUT_TOKENS = 1500;
export const CITE_OUT_TOKENS = 300;

const AUDIENCE = { advisor: 'the thesis advisor, who wants the progress, the results and the open decisions', group: 'a reading group, who wants what was read, what it says and what to discuss', me: 'the researcher themself, as a record of the period' } as const;

export function reportSystem(language: Lang, audience: keyof typeof AUDIENCE): string {
  return structuredSystem({
    version: REPORT_VERSION,
    role: `You write a short progress report of a research project for ${AUDIENCE[audience]}, from the research outline and the activity of the period.`,
    output: 'JSON {"markdown": "<the report in Markdown: a title line, then short sections only for the parts the data has, ending with \\"Next steps\\">"}.',
    rules: ['Every statement about a paper must carry its marker, like [R1], exactly as given in the data; never write a link or any other identifier.', 'Report the claims and their evidence as the data states them; do not strengthen or add results.', 'If a part has no data, leave it out.'],
    language,
  });
}

const strip = (t: string) => t.replace(/<<<|>>>/g, ' ');
export const reportPrompt = (context: string): string => `<<<DATA\n${strip(context)}\nDATA>>>\nWrite the report.`;

export function citeSystem(language: Lang): string {
  return structuredSystem({
    version: CITE_VERSION,
    role: 'You help a researcher cite sources: given ONE paragraph of their own text and candidate papers found in their library, you say which candidates really support it.',
    output: 'JSON {"ranking": [{"id": "<candidate id, like C1>", "reason": "<one sentence: what the paper says that supports the paragraph>"}]}. At most 3 entries, best first; leave out candidates that do not support the paragraph, and return an empty list when none does.',
    rules: ['Use only the ids of the candidates given; the reason must rest on the candidate text shown, never on what you remember of the paper.'],
    language,
  });
}

export const citePrompt = (paragraph: string, candidates: ReadonlyArray<{ id: string; meta: string; snippet: string }>): string =>
  `<<<DATA paragraph\n${strip(paragraph)}\nDATA>>>\n${candidates.map((c) => `<<<DATA candidate ${c.id}\n${strip(c.meta)}${c.snippet ? `\npassage: ${strip(c.snippet)}` : ''}\nDATA>>>`).join('\n')}\nRank the candidates that support the paragraph.`;

/** The `[R1]` markers of a report become links to the papers they stand for; a marker that is not in the map is dropped. */
export const linkMarkers = (md: string, refs: ReadonlyMap<string, { docId: string; title: string }>): string =>
  md.replace(/\s?\[R(\d{1,3})\]/g, (_m, n: string) => {
    const r = refs.get(`R${n}`);
    return r ? ` [${r.title.replace(/[[\]]/g, '')}](lab://doc/${r.docId})` : '';
  });
