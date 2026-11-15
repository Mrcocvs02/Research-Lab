/**
 * One factory per IPC domain. To add a domain: create `<domain>-handlers.ts` exporting
 * `(s: MainServices) => DomainHandlers<'<domain>'>` and add it to the list below.
 */
import type { Channels, HandlerMap } from '@rl/core';
import { appHandlers, dialogHandlers, importHandlers, libraryHandlers, secretsHandlers, settingsHandlers } from './core-handlers.js';
import type { MainServices } from './services.js';

export type { MainServices } from './services.js';

export function buildHandlers(s: MainServices): HandlerMap<Channels> {
  return {
    ...appHandlers(s),
    ...settingsHandlers(s),
    ...libraryHandlers(s),
    ...dialogHandlers(s),
    ...importHandlers(s),
    ...secretsHandlers(s),
  };
}
