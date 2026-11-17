/**
 * The inbox (phase 4, wave 4.2): contract in `packages/core/src/ipc/channels/inbox.ts`, logic in `main/inbox/`.
 */
import { loadCtx } from '../../ai/service.js';
import { addToInbox, chooseForInbox, confirmItem, dismissItem, listInbox, lookupItem, previewTags, proposeTags } from '../../inbox/service.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const inboxHandlers = (s: MainServices): DomainHandlers<'inbox'> => ({
  'inbox:list': () => listInbox(s),
  'inbox:add': ({ paths }) => addToInbox(s, paths),
  'inbox:choose': () => chooseForInbox(s),
  'inbox:lookup': ({ id }) => lookupItem(s, id),
  'inbox:previewTags': (req) => previewTags(s, req),
  'inbox:proposeTags': async (req) => proposeTags(s, await loadCtx(s), req),
  'inbox:confirm': (req) => confirmItem(s, req),
  'inbox:dismiss': ({ id }) => dismissItem(s, id),
});
