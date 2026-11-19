/**
 * Review of the AI proposals (phase 4, wave 4.2): contract in `packages/core/src/ipc/channels/review.ts`, logic in
 * `main/ai/review.ts`. Every decision is one logged change that `history:undo` reverts as a whole.
 */
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

// Loaded on first use: the start of the app does not carry the review code.
const review = () => import('../../ai/review.js');

export const reviewHandlers = (s: MainServices): DomainHandlers<'review'> => ({
  'review:list': async (q) => (await review()).listReview(await s.runtime.require(), q),
  'review:decide': async (d) => {
    const rt = await s.runtime.require();
    const r = await (await review()).applyDecisions(s, rt, [d], `Review of AI ${d.field}: ${d.decision}`, true);
    const { legacy: _legacy, ...document } = r.documents.get(d.docId)!;
    return { document, changeId: r.changeId, createdNodeIds: r.createdNodeIds };
  },
  'review:decideMany': async ({ items, decision }) => {
    const rt = await s.runtime.require();
    const r = await (await review()).applyDecisions(s, rt, items.map((i) => ({ ...i, decision })), `Review of ${items.length} AI proposal(s): ${decision}`, false);
    return { changeId: r.changeId, changed: r.changed, failed: r.failed.map(({ docId, field, code }) => ({ docId, field, code })) };
  },
  'review:stats': async () => (await review()).reviewStats(await s.runtime.require()),
});
