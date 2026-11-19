import { z } from 'zod';
import { documentIdSchema, isoDateSchema, itemIdSchema } from '../../common.js';
import { defineChannels } from '../registry.js';

/** Sizes of the research outline of a project (the Schema tab, X7). */
export const OUTLINE_LIMITS = { idea: 4000, plan: 4000, question: 500, questions: 30, hypothesis: 500, hypotheses: 30, claim: 600, evidence: 60, excerpt: 600, paragraph: 3000, sources: 100 } as const;

const questionIdSchema = z.string().regex(/^[a-z0-9]{1,24}$/);

/** The "Ricerca" part of `projects/<id>/outline.md`: idea, questions (with the papers assigned to each), hypotheses and plan. */
export const outlineSchema = z.object({
  idea: z.string().max(OUTLINE_LIMITS.idea),
  questions: z.array(z.object({ id: questionIdSchema, text: z.string().trim().min(1).max(OUTLINE_LIMITS.question), sources: z.array(documentIdSchema).max(OUTLINE_LIMITS.sources) })).max(OUTLINE_LIMITS.questions),
  hypotheses: z.array(z.string().trim().min(1).max(OUTLINE_LIMITS.hypothesis)).max(OUTLINE_LIMITS.hypotheses),
  plan: z.string().max(OUTLINE_LIMITS.plan),
});
export type Outline = z.infer<typeof outlineSchema>;

export const evidenceSchema = z.object({
  docId: documentIdSchema,
  page: z.number().int().positive(),
  annId: itemIdSchema.optional(),
  stance: z.enum(['supports', 'contradicts']),
  excerpt: z.string().max(OUTLINE_LIMITS.excerpt),
});
export type Evidence = z.infer<typeof evidenceSchema>;

/** `projects/<id>/claims/<id>.md`: a claim, the question it answers and its evidence (links `lab://doc/<id>?page=N&ann=<annId>`). */
export const claimSchema = z.object({
  id: itemIdSchema,
  questionId: questionIdSchema.nullable(),
  text: z.string().trim().min(1).max(OUTLINE_LIMITS.claim),
  evidence: z.array(evidenceSchema).max(OUTLINE_LIMITS.evidence),
});
export type Claim = z.infer<typeof claimSchema>;

export const REPORT_PARTS = ['reading', 'highlights', 'notes', 'claims', 'papers', 'next'] as const;
export const REPORT_AUDIENCES = ['advisor', 'group', 'me'] as const;
export const reportRequestSchema = z.object({
  projectId: itemIdSchema,
  days: z.number().int().min(1).max(365).default(14),
  audience: z.enum(REPORT_AUDIENCES).default('advisor'),
  parts: z.array(z.enum(REPORT_PARTS)).min(1).max(REPORT_PARTS.length).default([...REPORT_PARTS]),
  model: z.string().min(1).max(100).optional(),
});

/** Limits of the manuscript of a project (§18.1): sections read from a file or written in the app, and what is assigned to them. */
export const MANUSCRIPT_LIMITS = { sections: 500, title: 200, assignments: 20000, refs: 200 } as const;
const sectionIdSchema = z.string().regex(/^[a-z0-9]{1,24}$/);
/** What can be assigned to a section: a paper, a highlight, a note, a literature note or a claim. */
export const manuscriptRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('doc'), docId: documentIdSchema }),
  z.object({ kind: z.literal('ann'), docId: documentIdSchema, annId: itemIdSchema, page: z.number().int().positive() }),
  z.object({ kind: z.literal('note'), docId: documentIdSchema, page: z.number().int().positive().optional() }),
  z.object({ kind: z.literal('litnote'), docId: documentIdSchema }),
  z.object({ kind: z.literal('claim'), claimId: itemIdSchema }),
]);
export type ManuscriptRef = z.infer<typeof manuscriptRefSchema>;
const readSchema = z.object({ files: z.number().int().nonnegative(), total: z.number().int().nonnegative() });
/** `projects/<id>/manuscript.json`: the sections (written here or read from a file) and what is assigned to each. */
export const manuscriptSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('app') }),
    z.object({ kind: z.literal('file'), name: z.string().max(260), ext: z.enum(['md', 'tex', 'docx']), size: z.number().nonnegative(), mtimeMs: z.number().nonnegative(), headingsHash: z.string().max(64), read: readSchema.optional() }),
  ]),
  sections: z.array(z.object({ id: sectionIdSchema, title: z.string().max(MANUSCRIPT_LIMITS.title), level: z.number().int().min(1).max(4), order: z.number().int().nonnegative(), gone: z.literal(true).optional() })).max(MANUSCRIPT_LIMITS.sections),
  assignments: z.array(z.object({ sectionId: sectionIdSchema, ref: manuscriptRefSchema, origin: z.enum(['user', 'ai']), at: isoDateSchema })).max(MANUSCRIPT_LIMITS.assignments),
});
export type Manuscript = z.infer<typeof manuscriptSchema>;
const manuscriptState = z.object({
  manuscript: manuscriptSchema.nullable(),
  /** State of the linked file; null when the sections are written in the app or there is no manuscript. */
  file: z.object({ state: z.enum(['ok', 'missing', 'unreadable']), name: z.string(), read: readSchema, reason: z.string().optional() }).nullable(),
  /** Set when the file was read again because it had changed. */
  changes: z.object({ added: z.number().int().nonnegative(), renamed: z.number().int().nonnegative(), removed: z.number().int().nonnegative() }).optional(),
  /** The file dialog was closed without a choice. */
  cancelled: z.boolean().optional(),
});

const projectId = z.object({ projectId: itemIdSchema });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const evidenceItemSchema = z.object({
  docId: documentIdSchema,
  title: z.string(),
  page: z.number().int().positive(),
  stance: z.enum(['supports', 'contradicts']),
  excerpt: z.string().max(OUTLINE_LIMITS.excerpt),
});
const candidateSchema = z.object({
  docId: documentIdSchema,
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  reason: z.string(),
  page: z.number().int().positive().nullable(),
  /** The BibTeX key (or a derived one) to copy as `\cite{key}` or `[@key]`. */
  key: z.string(),
});
const sendCosts = {
  model: z.string(),
  approxTokens: z.number().int().nonnegative(),
  estimatedUsd: z.number().nonnegative().nullable(),
  needsDialog: z.boolean(),
  overDailyCap: z.boolean(),
};
const previewShape = z.object({ text: z.string(), candidates: z.number().int().nonnegative(), ...sendCosts });

export const projectSchemaChannels = defineChannels('project', {
  /** The schema tab of a project: the outline (null until it is written), the claims, the reports, the paragraph consent. */
  schema: {
    request: projectId,
    response: z.object({ outline: outlineSchema.nullable(), claims: z.array(claimSchema), reports: z.array(z.object({ date: z.string(), title: z.string() })), paragraphConsentAt: isoDateSchema.nullable() }),
  },
  saveOutline: { request: projectId.extend({ outline: outlineSchema }), response: z.object({ outline: outlineSchema }) },
  /** Creates (no `id`) or replaces a claim. */
  saveClaim: { request: projectId.extend({ claim: claimSchema.extend({ id: itemIdSchema.optional() }) }), response: z.object({ claim: claimSchema }) },
  removeClaim: { request: projectId.extend({ id: itemIdSchema }), response: z.object({ removed: z.boolean() }) },
  /** "Usa come prova": adds one piece of evidence to a claim, creating the claim first when `claimId` is absent. */
  addEvidence: {
    request: projectId.extend({ claimId: itemIdSchema.optional(), newClaim: z.object({ text: z.string().trim().min(1).max(OUTLINE_LIMITS.claim), questionId: questionIdSchema.nullable() }).optional(), evidence: evidenceSchema }),
    response: z.object({ claim: claimSchema }),
  },
  /** The exact text a report would send, with the estimate; nothing leaves. */
  reportPreview: { request: reportRequestSchema, response: z.object({ text: z.string(), ready: z.boolean(), reason: z.enum(['no-outline']).nullable(), ...sendCosts }) },
  /** Writes the report with Claude and saves it as `reports/<date>.md`. */
  reportRun: { request: reportRequestSchema.extend({ confirmed: z.boolean().default(false) }), response: z.object({ date, body: z.string() }) },
  reportGet: { request: projectId.extend({ date }), response: z.object({ body: z.string() }) },
  reportSave: { request: projectId.extend({ date, body: z.string().max(100_000) }), response: z.object({ ok: z.literal(true) }) },
  /** Grants or revokes "Send my paragraphs to Claude" for this project (D-423). */
  consent: { request: projectId.extend({ granted: z.boolean() }), response: z.object({ at: isoDateSchema.nullable() }) },
  /** The exact paragraph that would go out and what it costs; nothing leaves. */
  citePreview: { request: projectId.extend({ text: z.string().trim().min(1).max(OUTLINE_LIMITS.paragraph), model: z.string().min(1).max(100).optional() }), response: z.object({ text: z.string(), consent: z.boolean(), candidates: z.number().int().nonnegative(), ...sendCosts }) },
  /** Up to three candidates for one paragraph: local retrieval, then Claude reorders them (needs the project consent). */
  citeRun: { request: projectId.extend({ text: z.string().trim().min(1).max(OUTLINE_LIMITS.paragraph), model: z.string().min(1).max(100).optional(), confirmed: z.boolean().default(false) }), response: z.object({ items: z.array(candidateSchema).max(3) }) },
  /** The exact text "Find evidence" would send for a claim (its text and the best local passages); nothing leaves. */
  evidencePreview: { request: projectId.extend({ claimId: itemIdSchema, model: z.string().min(1).max(100).optional() }), response: previewShape },
  /** Local search in the index, then Claude (Haiku) sorts the best passages into supports, contradicts or not relevant; each stays a proposal until the user accepts it. */
  evidenceRun: { request: projectId.extend({ claimId: itemIdSchema, model: z.string().min(1).max(100).optional(), confirmed: z.boolean().default(false) }), response: z.object({ items: z.array(evidenceItemSchema).max(10) }) },
  /** The exact text "✦ Propose the assignments" would send (section titles and title + abstract of the papers in enabled folders; never the manuscript); nothing leaves. */
  previewAssignSuggest: { request: projectId.extend({ model: z.string().min(1).max(100).optional() }), response: previewShape },
  /** Claude proposes papers for sections; nothing is written, each proposal is accepted by the user (`project:assign`, origin `ai`). */
  assignSuggest: { request: projectId.extend({ model: z.string().min(1).max(100).optional(), confirmed: z.boolean().default(false) }), response: z.object({ items: z.array(z.object({ sectionId: sectionIdSchema, docId: documentIdSchema })) }) },
  /** An accepted suggestion: the paper becomes a source of the question in the outline. */
  assignCitation: { request: projectId.extend({ questionId: questionIdSchema, docId: documentIdSchema }), response: z.object({ outline: outlineSchema }) },
  /** The manuscript of the project; a linked file that changed since the last read is read again here (sections realigned, nothing lost). */
  manuscript: { request: projectId, response: manuscriptState },
  /** Writes the sections in the app, links a file (the dialog opens in main; the file is only read) or unlinks the manuscript (deletes `manuscript.json`; the interface confirms first). */
  setManuscript: {
    request: projectId.extend({
      source: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('app'), sections: z.array(z.object({ id: sectionIdSchema.optional(), title: z.string().trim().min(1).max(MANUSCRIPT_LIMITS.title), level: z.number().int().min(1).max(4) })).max(MANUSCRIPT_LIMITS.sections) }),
        z.object({ kind: z.literal('file'), title: z.string().max(200).optional() }),
        z.object({ kind: z.literal('none') }),
      ]),
    }),
    response: manuscriptState,
  },
  /** Adds (`on`) or removes references to a section. */
  assign: { request: projectId.extend({ sectionId: sectionIdSchema, refs: z.array(manuscriptRefSchema).min(1).max(MANUSCRIPT_LIMITS.refs), on: z.boolean(), origin: z.enum(['user', 'ai']).default('user') }), response: z.object({ manuscript: manuscriptSchema }) },
  /** Moves every assignment of a section to another one, or removes them (`to` null); a vanished section left empty goes away. */
  moveAssignments: { request: projectId.extend({ from: sectionIdSchema, to: sectionIdSchema.nullable() }), response: z.object({ manuscript: manuscriptSchema }) },
});
