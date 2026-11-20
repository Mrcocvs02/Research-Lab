import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const feature = () => import('../../features/vocab-pack/index.js');

/** The field vocabulary (packs): everything lives in a chunk loaded on first use (`features/vocab-pack`). */
export const vocabPackHandlers = (s: MainServices): DomainHandlers<'vocabPack'> => ({
  'vocabPack:list': async (r) => (await feature()).list(s, r),
  'vocabPack:preview': async (r) => (await feature()).preview(s, r),
  'vocabPack:enable': async (r) => (await feature()).enable(s, r),
  'vocabPack:disable': async (r) => (await feature()).disable(s, r),
  'vocabPack:search': async (r) => (await feature()).search(s, r),
  'vocabPack:materialize': async (r) => (await feature()).materialize(s, r),
});
