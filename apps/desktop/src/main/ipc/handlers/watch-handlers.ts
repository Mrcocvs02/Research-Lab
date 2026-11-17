/** Monitoring (phase 5): contract in `packages/core/src/ipc/channels/watch.ts`, logic in `main/citations/watch.ts`. */
import { applyPublished, cancelWatchOp, checkPublished, checkSources, dismissItem, listSources, removeSource, resetSources, saveSource, watchItems } from '../../citations/watch.js';
import type { DomainHandlers } from '../types.js';
import { settle } from './organize-handlers.js';
import type { MainServices } from './services.js';

export const watchHandlers = (s: MainServices): DomainHandlers<'watch'> => ({
  'watch:list': () => listSources(s),
  'watch:saveSource': (req) => saveSource(s, req),
  'watch:removeSource': ({ id }) => removeSource(s, id),
  'watch:check': (req) => checkSources(s, req),
  'watch:cancel': async ({ op }) => cancelWatchOp(op),
  'watch:reset': () => resetSources(s),
  'watch:items': (req) => watchItems(s, req),
  'watch:dismiss': (req) => dismissItem(s, req),
  'watch:checkPublished': (req) => checkPublished(s, req),
  'watch:applyPublished': (req) => applyPublished(s, req, (rt, ids) => settle(s, rt, { reindex: ids }, ids.length > 0 ? [{ kind: 'documents', ids }] : [])),
});
