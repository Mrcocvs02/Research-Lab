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
  evidencePreview: { request: projectId.extend({ claimId: itemIdSchema, model: z.string().min(1).max(100).optional() }), response: z.object({ text: z.string(), candidates: z.number().int().nonnegative(), ...sendCosts }) },
  /** Local search in the index, then Claude (Haiku) sorts the best passages into supports, contradicts or not relevant; each stays a proposal until the user accepts it. */
  evidenceRun: { request: projectId.extend({ claimId: itemIdSchema, model: z.string().min(1).max(100).optional(), confirmed: z.boolean().default(false) }), response: z.object({ items: z.array(evidenceItemSchema).max(10) }) },
  /** An accepted suggestion: the paper becomes a source of the question in the outline. */
  assignCitation: { request: projectId.extend({ questionId: questionIdSchema, docId: documentIdSchema }), response: z.object({ outline: outlineSchema }) },
});
