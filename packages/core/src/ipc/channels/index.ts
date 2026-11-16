/**
 * THE channel registry. To add a domain: create `channels/<domain>.ts` with `defineChannels`
 * (and optionally `defineEvents`), then add ONE import and ONE line to each merge below.
 */
import { mergeRegistries } from '../registry.js';
import { appChannels, appEvents } from './app.js';
import { dialogChannels } from './dialog.js';
import { documentsChannels } from './documents.js';
import { importChannels, importEvents } from './import.js';
import { libraryChannels } from './library.js';
import { scanChannels, scanEvents } from './scan.js';
import { indexChannels, searchChannels } from './search.js';
import { secretsChannels } from './secrets.js';
import { settingsChannels } from './settings.js';

export const channels = mergeRegistries(appChannels, settingsChannels, libraryChannels, dialogChannels, importChannels, secretsChannels, scanChannels, searchChannels, indexChannels, documentsChannels);

export const events = mergeRegistries(appEvents, importEvents, scanEvents);

export type Channels = typeof channels;
export type Events = typeof events;
export type ChannelName = keyof Channels & string;
export type EventName = keyof Events & string;

export { appNoticeSchema, type AppNotice } from './app.js';
export { scanStatusSchema, scanSummarySchema, type ScanStatus, type ScanSummary } from './scan.js';
export { searchFiltersSchema, searchFacetsSchema, searchHitSchema, SEARCH_LIMITS, SEARCH_MARK_OPEN, SEARCH_MARK_CLOSE } from './search.js';
export { documentSummarySchema, documentViewSchema } from './documents.js';
