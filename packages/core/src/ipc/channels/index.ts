/**
 * THE channel registry. To add a domain: create `channels/<domain>.ts` with `defineChannels`
 * (and optionally `defineEvents`), then add ONE import and ONE line to each merge below.
 */
import { mergeRegistries } from '../registry.js';
import { appChannels, appEvents } from './app.js';
import { dialogChannels } from './dialog.js';
import { importChannels, importEvents } from './import.js';
import { libraryChannels } from './library.js';
import { secretsChannels } from './secrets.js';
import { settingsChannels } from './settings.js';

export const channels = mergeRegistries(appChannels, settingsChannels, libraryChannels, dialogChannels, importChannels, secretsChannels);

export const events = mergeRegistries(appEvents, importEvents);

export type Channels = typeof channels;
export type Events = typeof events;
export type ChannelName = keyof Channels & string;
export type EventName = keyof Events & string;

export { appNoticeSchema, type AppNotice } from './app.js';
