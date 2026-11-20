import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const feature = () => import('../../features/tag-review/index.js');

/** Vocabulary review and guided cleanup: everything lives in a chunk loaded on first use (`features/tag-review`). */
export const tagReviewHandlers = (s: MainServices): DomainHandlers<'tagReview'> => ({
  'tagReview:get': async (r) => (await feature()).getReview(s, r),
  'tagReview:apply': async (r) => (await feature()).applyReview(s, r),
  'tagReview:reject': async (r) => (await feature()).rejectReview(s, r),
  'tagReview:setAuto': async (r) => (await feature()).setAuto(s, r),
  'tagReview:skip': async (r) => (await feature()).skipStep(s, r),
  'tagReview:aiPreview': async (r) => (await feature()).aiPreview(s, r),
  'tagReview:aiCancel': async () => (await feature()).aiCancel(),
  'tagReview:aiRun': async (r) => (await feature()).aiRun(s, r),
  'tagReview:undoRun': async (r) => (await feature()).undoRun(s, r),
});
