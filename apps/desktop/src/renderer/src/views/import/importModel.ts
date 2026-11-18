import type { Channels, ResponseOf } from '@rl/core';

export type Analysis = ResponseOf<Channels, 'bib:analyze'>;
export type ImportResult = ResponseOf<Channels, 'bib:import'>;
export type CollectionsChoice = 'projects' | 'tags' | 'ignore';

export interface ImportChoices {
  tags: boolean;
  notes: boolean;
  queueFiles: boolean;
  collections: CollectionsChoice;
}

/** What the summary offers by default: everything the file has, collections as projects. */
export const defaultChoices = (a: Analysis): ImportChoices => ({ tags: a.tags > 0, notes: a.notes > 0, queueFiles: a.withFile > 0, collections: a.collections.length > 0 ? 'projects' : 'ignore' });

/** A file name for the linked .bib of a project: its name reduced to letters and digits. */
export function bibFileName(projectName: string): string {
  const base = projectName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'references'}.bib`;
}

/** Reason codes of a "Not imported" row, as the i18n key suffix. */
export const reasonKey = (reason: string): string => (['no-file', 'not-queued', 'empty', 'not-pdf', 'too-large', 'not-found', 'in-library'].includes(reason) ? reason : 'other');
