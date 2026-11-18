/**
 * THE channel registry. To add a domain: create `channels/<domain>.ts` with `defineChannels`
 * (and optionally `defineEvents`), then add ONE import and ONE line to each merge below.
 */
import { mergeRegistries } from '../registry.js';
import { aiChannels, aiEvents } from './ai.js';
import { backupChannels, backupEvents } from './backup.js';
import { annotationsChannels, annotationsEvents } from './annotations.js';
import { appChannels, appEvents } from './app.js';
import { chatChannels, chatEvents } from './chat.js';
import { citationsChannels, citationsEvents, recommendChannels } from './citations.js';
import { commandsChannels } from './commands.js';
import { dialogChannels } from './dialog.js';
import { documentsChannels } from './documents.js';
import { exploreChannels, graphChannels, graphEvents } from './graph.js';
import { exportChannels, exportEvents } from './export.js';
import { importChannels, importEvents } from './import.js';
import { inboxChannels, inboxEvents } from './inbox.js';
import { jobsChannels, jobsEvents } from './jobs.js';
import { historyChannels } from './history.js';
import { mcpChannels, mcpEvents } from './mcp.js';
import { libraryChannels, libraryEvents } from './library.js';
import { maintenanceChannels } from './maintenance.js';
import { notesChannels } from './notes.js';
import { projectsChannels } from './projects.js';
import { readerChannels } from './reader.js';
import { reviewChannels } from './review.js';
import { taxonomyChannels } from './taxonomy.js';
import { thumbsChannels } from './thumbs.js';
import { watchChannels, watchEvents } from './watch.js';
import { scanChannels, scanEvents } from './scan.js';
import { indexChannels, searchChannels } from './search.js';
import { secretsChannels } from './secrets.js';
import { settingsChannels } from './settings.js';

export const channels = mergeRegistries(appChannels, settingsChannels, libraryChannels, dialogChannels, importChannels, secretsChannels, scanChannels, searchChannels, indexChannels, documentsChannels, taxonomyChannels, historyChannels, projectsChannels, readerChannels, notesChannels, annotationsChannels, thumbsChannels, aiChannels, chatChannels, commandsChannels, jobsChannels, reviewChannels, inboxChannels, citationsChannels, recommendChannels, watchChannels, graphChannels, exploreChannels, exportChannels, mcpChannels, backupChannels, maintenanceChannels);

export const events = mergeRegistries(aiEvents, annotationsEvents, appEvents, importEvents, scanEvents, libraryEvents, chatEvents, jobsEvents, inboxEvents, citationsEvents, watchEvents, graphEvents, exportEvents, mcpEvents, backupEvents);

export type Channels = typeof channels;
export type Events = typeof events;
export type ChannelName = keyof Channels & string;
export type EventName = keyof Events & string;

export { appNoticeSchema, type AppNotice } from './app.js';
export { scanReportSchema, scanStatusSchema, scanSummarySchema, type ScanReport, type ScanStatus, type ScanSummary } from './scan.js';
export { searchFiltersSchema, searchFacetsSchema, searchHitSchema, SEARCH_MARK_OPEN, SEARCH_MARK_CLOSE } from './search.js';
export { documentSummarySchema, documentViewSchema } from './documents.js';
export { documentPatchSchema, type DocumentPatch } from './documents.js';
export { folderNodeSchema } from './library.js';
export { taxonomyOpSchema, taxonomyViewSchema, taxonomyNodeViewSchema, nodeCountsSchema, TAXONOMY_LIMITS, type TaxonomyOp, type TaxonomyView, type TaxonomyNodeView } from './taxonomy.js';
export { historyItemSchema, historyResultSchema } from './history.js';
export { projectDetailSchema, projectSummarySchema, projectMemberViewSchema, readingPlanItemViewSchema, studyCountsSchema, type ProjectDetail } from './projects.js';
export { noteViewSchema, noteListItemSchema, type NoteView } from './notes.js';
export { annotationColorSchema, annotationInputSchema, pdfReasonSchema, pdfStateSchema, type AnnotationInput, type PdfReason, type PdfState } from './annotations.js';
export { thumbItemSchema } from './thumbs.js';
export { aiAccountSchema, aiAuthSchema, aiPreviewSchema, aiSendViewSchema, aiStatusSchema, type AiAccount, type AiTokenUsage, aiTokenUsageSchema } from './ai.js';
export { chatCardSchema, chatConversationSummarySchema, chatTurnSchema, chatUsageSchema } from './chat.js';
export { aiJobFieldSchema, aiJobRequestSchema, aiJobStatusSchema, type AiJobField, type AiJobStatus } from './jobs.js';
export { reviewFieldSchema, reviewItemSchema, type ReviewField, type ReviewItem } from './review.js';
export { inboxItemSchema, inboxMetadataSchema, type InboxItem, type InboxMetadata } from './inbox.js';
export { citationLinkViewSchema, citationViewSchema, citationJobStatusSchema, readNextItemSchema, CITATION_LIMITS, type CitationView } from './citations.js';
export { watchSourceViewSchema, publishedProposalSchema } from './watch.js';
export { authorAliasesSchema, clusterViewSchema, exploreDimensionSchema, exploreNodeSchema, graphStatusSchema, similarityReasonSchema, GRAPH_LIMITS } from './graph.js';
export { exportEstimateSchema, exportJobStatusSchema, exportResultSchema, exportSelectionSchema, exportTargetSchema, EXPORT_LIMITS, type ExportSelection } from './export.js';
export { mcpLogItemSchema, mcpStatusSchema, mcpToolNameSchema, MCP_LIMITS, MCP_TOOL_NAMES, type McpStatus } from './mcp.js';
export { backupInfoSchema, backupJobStatusSchema, backupManifestSchema, backupPreviewSchema, backupResultSchema, backupSettingsSchema, BACKUP_FORMAT_VERSION, BACKUP_LIMITS, type BackupInfo, type BackupJobStatus, type BackupManifest, type BackupSettings } from './backup.js';
export { maintenanceTargetSchema, MAINTENANCE_TARGETS } from './maintenance.js';
