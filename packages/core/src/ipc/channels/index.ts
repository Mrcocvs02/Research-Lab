/**
 * THE channel registry. To add a domain: create `channels/<domain>.ts` with `defineChannels`
 * (and optionally `defineEvents`), then add ONE import and ONE line to each merge below.
 */
import { mergeRegistries } from '../registry.js';
import { annotationsChannels } from './annotations.js';
import { appChannels, appEvents } from './app.js';
import { dialogChannels } from './dialog.js';
import { documentsChannels } from './documents.js';
import { importChannels, importEvents } from './import.js';
import { historyChannels } from './history.js';
import { libraryChannels, libraryEvents } from './library.js';
import { notesChannels } from './notes.js';
import { projectsChannels } from './projects.js';
import { readerChannels } from './reader.js';
import { taxonomyChannels } from './taxonomy.js';
import { scanChannels, scanEvents } from './scan.js';
import { indexChannels, searchChannels } from './search.js';
import { secretsChannels } from './secrets.js';
import { settingsChannels } from './settings.js';

export const channels = mergeRegistries(appChannels, settingsChannels, libraryChannels, dialogChannels, importChannels, secretsChannels, scanChannels, searchChannels, indexChannels, documentsChannels, taxonomyChannels, historyChannels, projectsChannels, readerChannels, notesChannels, annotationsChannels);

export const events = mergeRegistries(appEvents, importEvents, scanEvents, libraryEvents);

export type Channels = typeof channels;
export type Events = typeof events;
export type ChannelName = keyof Channels & string;
export type EventName = keyof Events & string;

export { appNoticeSchema, type AppNotice } from './app.js';
export { scanStatusSchema, scanSummarySchema, type ScanStatus, type ScanSummary } from './scan.js';
export { searchFiltersSchema, searchFacetsSchema, searchHitSchema, SEARCH_MARK_OPEN, SEARCH_MARK_CLOSE } from './search.js';
export { documentSummarySchema, documentViewSchema } from './documents.js';
export { documentPatchSchema, type DocumentPatch } from './documents.js';
export { folderNodeSchema } from './library.js';
export { taxonomyOpSchema, taxonomyViewSchema, taxonomyNodeViewSchema, nodeCountsSchema, TAXONOMY_LIMITS, type TaxonomyOp, type TaxonomyView, type TaxonomyNodeView } from './taxonomy.js';
export { historyItemSchema, historyResultSchema } from './history.js';
export { projectDetailSchema, projectSummarySchema, projectMemberViewSchema, readingPlanItemViewSchema, studyCountsSchema, type ProjectDetail } from './projects.js';
export { noteViewSchema, noteListItemSchema, type NoteView } from './notes.js';
export { annotationColorSchema, annotationInputSchema, type AnnotationInput } from './annotations.js';
