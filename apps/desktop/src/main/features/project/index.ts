import { AppError, documentIdSchema, type Claim, type Evidence, type Outline } from '@rl/core';
import type { MainServices } from '../../ipc/handlers/services.js';
import { listClaims, listReports, newId, readConsent, readOutline, readReport, removeClaim as dropClaim, writeClaim, writeConsent, writeOutline, writeReport } from './store.js';

/**
 * The Schema tab of a project (X7): the research outline, the claims with their evidence, the reports and the consent to send
 * paragraphs. Nothing here talks to Claude (that is `ai.ts`). Loaded on demand (dynamic import behind the IPC handler).
 */
export async function ctxOf(s: MainServices, projectId: string) {
  const rt = await s.runtime.require();
  const project = await rt.store.projects.get(projectId);
  if (!project) throw new AppError('NOT_FOUND', 'Unknown project');
  return { rt, project, dataDir: rt.store.dataDir };
}

const changed = (s: MainServices, projectId: string) => s.emit('library:changed', { kind: 'projects', ids: [projectId] });

export async function getSchema(s: MainServices, req: { projectId: string }) {
  const { dataDir } = await ctxOf(s, req.projectId);
  const [outline, claims, reports, paragraphConsentAt] = await Promise.all([readOutline(dataDir, req.projectId), listClaims(dataDir, req.projectId), listReports(dataDir, req.projectId), readConsent(dataDir, req.projectId)]);
  return { outline, claims, reports, paragraphConsentAt };
}

export async function saveOutline(s: MainServices, req: { projectId: string; outline: Outline }) {
  const { dataDir } = await ctxOf(s, req.projectId);
  // A claim whose question was removed keeps the claim: it goes back to "no question".
  const keep = new Set(req.outline.questions.map((q) => q.id));
  for (const c of await listClaims(dataDir, req.projectId)) if (c.questionId !== null && !keep.has(c.questionId)) await writeClaim(dataDir, req.projectId, { ...c, questionId: null });
  await writeOutline(dataDir, req.projectId, req.outline);
  changed(s, req.projectId);
  return { outline: req.outline };
}

export async function saveClaim(s: MainServices, req: { projectId: string; claim: Omit<Claim, 'id'> & { id?: string | undefined } }) {
  const { dataDir } = await ctxOf(s, req.projectId);
  const claim: Claim = { ...req.claim, id: req.claim.id ?? newId('c') };
  await writeClaim(dataDir, req.projectId, claim);
  changed(s, req.projectId);
  return { claim };
}

export async function removeClaim(s: MainServices, req: { projectId: string; id: string }) {
  const { dataDir } = await ctxOf(s, req.projectId);
  const removed = await dropClaim(dataDir, req.projectId, req.id);
  if (removed) changed(s, req.projectId);
  return { removed };
}

const same = (a: Evidence, b: Evidence) => a.docId === b.docId && a.page === b.page && a.annId === b.annId;

/** "Usa come prova": one more piece of evidence for a claim (made here when `claimId` is absent). The same highlight is never added twice. */
export async function addEvidence(s: MainServices, req: { projectId: string; claimId?: string | undefined; newClaim?: { text: string; questionId: string | null } | undefined; evidence: Evidence }) {
  const { dataDir } = await ctxOf(s, req.projectId);
  documentIdSchema.parse(req.evidence.docId);
  let claim: Claim | undefined;
  if (req.claimId) {
    claim = (await listClaims(dataDir, req.projectId)).find((c) => c.id === req.claimId);
    if (!claim) throw new AppError('NOT_FOUND', 'Unknown claim');
  } else if (req.newClaim) claim = { id: newId('c'), questionId: req.newClaim.questionId, text: req.newClaim.text, evidence: [] };
  else throw new AppError('INVALID_REQUEST', 'A claim or the text of a new one is needed');
  const next: Claim = { ...claim, evidence: [...claim.evidence.filter((e) => !same(e, req.evidence)), req.evidence] };
  await writeClaim(dataDir, req.projectId, next);
  changed(s, req.projectId);
  return { claim: next };
}

export async function getReport(s: MainServices, req: { projectId: string; date: string }) {
  const { dataDir } = await ctxOf(s, req.projectId);
  const body = await readReport(dataDir, req.projectId, req.date);
  if (body === null) throw new AppError('NOT_FOUND', 'Unknown report');
  return { body };
}

export async function saveReport(s: MainServices, req: { projectId: string; date: string; body: string }) {
  const { dataDir } = await ctxOf(s, req.projectId);
  await writeReport(dataDir, req.projectId, req.date, req.body);
  changed(s, req.projectId);
  return { ok: true as const };
}

export async function setConsent(s: MainServices, req: { projectId: string; granted: boolean }) {
  const { dataDir } = await ctxOf(s, req.projectId);
  return { at: await writeConsent(dataDir, req.projectId, req.granted) };
}

/** An accepted suggestion: the paper joins the sources of the question. */
export async function assignCitation(s: MainServices, req: { projectId: string; questionId: string; docId: string }) {
  const { dataDir } = await ctxOf(s, req.projectId);
  const outline = await readOutline(dataDir, req.projectId);
  const q = outline?.questions.find((x) => x.id === req.questionId);
  if (!outline || !q) throw new AppError('NOT_FOUND', 'Unknown question');
  if (!q.sources.includes(req.docId)) q.sources.push(req.docId);
  await writeOutline(dataDir, req.projectId, outline);
  changed(s, req.projectId);
  return { outline };
}
