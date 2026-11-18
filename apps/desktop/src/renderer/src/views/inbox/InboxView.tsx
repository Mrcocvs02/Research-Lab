import type { Channels, ResponseOf } from '@rl/core';

export type InboxItem = ResponseOf<Channels, 'inbox:list'>['items'][number];
/** The section "To review" (lazy entry kept under its old name): the hub of new files and Claude's proposals. */
export { ReviewHub as InboxView } from '../review/ReviewHub';
