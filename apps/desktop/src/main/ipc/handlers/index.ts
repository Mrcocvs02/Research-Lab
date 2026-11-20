/**
 * One factory per IPC domain. To add a domain: create `<domain>-handlers.ts` exporting
 * `(s: MainServices) => DomainHandlers<'<domain>'>` and add it to the list below.
 */
import type { Channels, HandlerMap } from '@rl/core';
import { appHandlers, dialogHandlers, importHandlers, libraryHandlers, secretsHandlers, settingsHandlers } from './core-handlers.js';
import { documentsHandlers } from './documents-handlers.js';
import { tagReviewHandlers } from './tag-review-handlers.js';
import { vocabPackHandlers } from './vocab-pack-handlers.js';
import { historyHandlers, organizeDocumentsHandlers, projectsHandlers, taxonomyHandlers } from './organize-handlers.js';
import { indexHandlers, scanHandlers } from './scan-handlers.js';
import { searchHandlers } from './search-handlers.js';
import type { MainServices } from './services.js';
import { aiHandlers, chatHandlers, commandsHandlers } from './ai-handlers.js';
import { annotationsHandlers, notesHandlers, readerHandlers, thumbsHandlers } from './study-handlers.js';
import { inboxHandlers } from './inbox-handlers.js';
import { mcpHandlers } from './mcp-handlers.js';
import { jobsHandlers } from './jobs-handlers.js';
import { reviewHandlers } from './review-handlers.js';
import { citationsHandlers } from './citations-handlers.js';
import { recommendHandlers } from './recommend-handlers.js';
import { watchHandlers } from './watch-handlers.js';
import { exploreHandlers } from './explore-handlers.js';
import { exportHandlers } from './export-handlers.js';
import { bibHandlers } from './bib-handlers.js';
import { importIdHandlers, resourcesHandlers, resumeHandlers } from './resources-handlers.js';
import { graphHandlers } from './graph-handlers.js';
import { backupHandlers, maintenanceHandlers } from './backup-handlers.js';
import { discoverHandlers } from './discover-handlers.js';
import { doclinksHandlers } from './doclinks-handlers.js';
import { projectSchemaHandlers } from './project-handlers.js';
import { cropsHandlers, explainHandlers, linksHandlers, literatureHandlers, templatesHandlers } from './readertools-handlers.js';
import { guidesHandlers, refsHandlers } from './refs-handlers.js';
import { citectxHandlers, compareHandlers, groupsHandlers } from './synthesis-handlers.js';

export type { MainServices } from './services.js';

export function buildHandlers(s: MainServices): HandlerMap<Channels> {
  return {
    ...appHandlers(s),
    ...settingsHandlers(s),
    ...libraryHandlers(s),
    ...dialogHandlers(s),
    ...importHandlers(s),
    ...secretsHandlers(s),
    ...scanHandlers(s),
    ...indexHandlers(s),
    ...searchHandlers(s),
    ...documentsHandlers(s),
    ...taxonomyHandlers(s),
    ...tagReviewHandlers(s),
    ...historyHandlers(s),
    ...projectsHandlers(s),
    ...organizeDocumentsHandlers(s),
    ...readerHandlers(s),
    ...notesHandlers(s),
    ...annotationsHandlers(s),
    ...thumbsHandlers(s),
    ...aiHandlers(s),
    ...chatHandlers(s),
    ...commandsHandlers(s),
    ...jobsHandlers(s),
    ...reviewHandlers(s),
    ...inboxHandlers(s),
    ...citationsHandlers(s),
    ...recommendHandlers(s),
    ...watchHandlers(s),
    ...graphHandlers(s),
    ...exploreHandlers(s),
    ...exportHandlers(s),
    ...mcpHandlers(s),
    ...backupHandlers(s),
    ...maintenanceHandlers(s),
    ...bibHandlers(s),
    ...cropsHandlers(s),
    ...explainHandlers(s),
    ...resourcesHandlers(s),
    ...importIdHandlers(s),
    ...resumeHandlers(s),
    ...literatureHandlers(s),
    ...templatesHandlers(s),
    ...linksHandlers(s),
    ...projectSchemaHandlers(s),
    ...discoverHandlers(s),
    ...doclinksHandlers(s),
    ...refsHandlers(s),
    ...guidesHandlers(s),
    ...compareHandlers(s),
    ...groupsHandlers(s),
    ...citectxHandlers(s),
    ...vocabPackHandlers(s),
  };
}
