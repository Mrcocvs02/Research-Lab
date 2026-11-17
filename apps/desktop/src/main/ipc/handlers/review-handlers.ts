/**
 * Review of the AI proposals (phase 4, wave 4.2): contract in `packages/core/src/ipc/channels/review.ts`, logic in
 * `main/ai/review.ts`. Every decision is one logged change that `history:undo` reverts as a whole.
 */
import { applyDecisions, listReview, reviewStats } from '../../ai/review.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const reviewHandlers = (s: MainServices): DomainHandlers<'review'> => ({
  'review:list': async (q) => listReview(await s.runtime.require(), q),
  'review:decide': async (d) => {
    const rt = await s.runtime.require();
    const r = await applyDecisions(s, rt, [d], `Review of AI ${d.field}: ${d.decision}`, true);
    const { legacy: _legacy, ...document } = r.documents.get(d.docId)!;
    return { document, changeId: r.changeId, createdNodeIds: r.createdNodeIds };
  },
  'review:decideMany': async ({ items, decision }) => {
    const rt = await s.runtime.require();
    const r = await applyDecisions(s, rt, items.map((i) => ({ ...i, decision })), `Review of ${items.length} AI proposal(s): ${decision}`, false);
    return { changeId: r.changeId, changed: r.changed, failed: r.failed.map(({ docId, field, code }) => ({ docId, field, code })) };
  },
  'review:stats': async () => reviewStats(await s.runtime.require()),
});
