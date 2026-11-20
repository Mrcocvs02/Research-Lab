/** Edits of the Map by hand and its saved views (D-521..D-527). Thin: the code is in lazy chunks, loaded on first use (D-408). */
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const moving = () => import('../../features/map-edit/move.js');
const views = () => import('../../features/map-edit/views.js');
const macros = () => import('../../graph/macro-run.js');

export const mapEditHandlers = (s: MainServices): DomainHandlers<'mapEdit'> => ({
  'mapEdit:move': async (r) => (await moving()).move(s, r),
  'mapEdit:macroPropose': async (r) => (await macros()).macroPropose(s, r),
  'mapEdit:macroApply': async (r) => (await macros()).macroApply(s, r),
});

export const mapViewsHandlers = (s: MainServices): DomainHandlers<'mapViews'> => ({
  'mapViews:list': async () => (await views()).list(s),
  'mapViews:save': async ({ view }) => (await views()).save(s, view),
  'mapViews:delete': async ({ id }) => (await views()).remove(s, id),
});
