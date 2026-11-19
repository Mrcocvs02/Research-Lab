/** The Schema tab of a project (X7): outline, claims and evidence, reports, citation suggestions. Contracts: `packages/core/src/ipc/channels/project.ts`. Logic in `features/project`, loaded on first use. */
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const feature = () => import('../../features/project/index.js');
const manuscript = () => import('../../features/manuscript/index.js');
const manuscriptAi = () => import('../../features/manuscript/ai.js');
const ai = () => import('../../features/project/ai.js');

export const projectSchemaHandlers = (s: MainServices): DomainHandlers<'project'> => ({
  'project:schema': async (req) => (await feature()).getSchema(s, req),
  'project:saveOutline': async (req) => (await feature()).saveOutline(s, req),
  'project:saveClaim': async (req) => (await feature()).saveClaim(s, req),
  'project:removeClaim': async (req) => (await feature()).removeClaim(s, req),
  'project:addEvidence': async (req) => (await feature()).addEvidence(s, req),
  'project:reportGet': async (req) => (await feature()).getReport(s, req),
  'project:reportSave': async (req) => (await feature()).saveReport(s, req),
  'project:consent': async (req) => (await feature()).setConsent(s, req),
  'project:assignCitation': async (req) => (await feature()).assignCitation(s, req),
  'project:manuscript': async (req) => (await manuscript()).getManuscript(s, req),
  'project:setManuscript': async (req) => (await manuscript()).setManuscript(s, req),
  'project:assign': async (req) => (await manuscript()).assign(s, req),
  'project:moveAssignments': async (req) => (await manuscript()).moveAssignments(s, req),
  'project:reportPreview': async (req) => (await ai()).reportPreview(s, req),
  'project:reportRun': async (req) => (await ai()).reportRun(s, req),
  'project:citePreview': async (req) => (await ai()).citePreview(s, req),
  'project:citeRun': async (req) => (await ai()).citeRun(s, req),
  'project:evidencePreview': async (req) => (await ai()).evidencePreview(s, req),
  'project:evidenceRun': async (req) => (await ai()).evidenceRun(s, req),
  'project:previewAssignSuggest': async (req) => (await manuscriptAi()).previewAssignSuggest(s, req),
  'project:assignSuggest': async (req) => (await manuscriptAi()).assignSuggest(s, req),
});
