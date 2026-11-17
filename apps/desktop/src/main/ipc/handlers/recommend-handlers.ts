/** Read-next recommendations (phase 5): contract in `packages/core/src/ipc/channels/citations.ts`, logic in `main/citations/recommend.ts`. */
import { dismissRecommendation, readNext } from '../../citations/recommend.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const recommendHandlers = (s: MainServices): DomainHandlers<'recommend'> => ({
  'recommend:readNext': (req) => readNext(s, req),
  'recommend:dismiss': ({ key }) => dismissRecommendation(s, key),
});
