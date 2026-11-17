import { AppError, ARXIV_SHAPE, isAllowedExternalUrl, isValidDoi, OPENALEX_WORK_SHAPE } from '@rl/core';
import type { MainServices } from '../ipc/handlers/services.js';

export type WorkKind = 'doi' | 'arxiv' | 'openalex';

const seg = (s: string) => s.split('/').map(encodeURIComponent).join('/');

/**
 * The page of a work, built here from an identifier of the right shape (never from a URL of the renderer): doi.org,
 * arxiv.org or openalex.org with each path segment encoded. Null when the identifier has the wrong shape.
 */
export function workUrl(kind: WorkKind, id: string): string | null {
  const v = id.trim();
  if (kind === 'doi') {
    const doi = v.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');
    return isValidDoi(doi) ? `https://doi.org/${seg(doi)}` : null;
  }
  if (kind === 'arxiv') {
    const ax = v.replace(/^arxiv:\s*/i, '');
    return ARXIV_SHAPE.test(ax) ? `https://arxiv.org/abs/${seg(ax)}` : null;
  }
  return OPENALEX_WORK_SHAPE.test(v) ? `https://openalex.org/${v}` : null;
}

/** `citations:openExternal`: validates the identifier, builds the URL, checks it against the allowed hosts, opens it. */
export async function openWork(s: MainServices, kind: WorkKind, id: string): Promise<{ ok: true }> {
  const url = workUrl(kind, id);
  if (!url) throw new AppError('INVALID_REQUEST', 'This is not a valid identifier', { reason: 'bad-identifier' });
  if (!isAllowedExternalUrl(url)) throw new AppError('PERMISSION_DENIED', 'This address cannot be opened');
  await s.shell.openExternal(url).catch(() => {
    throw new AppError('IO_ERROR', 'The system could not open the link');
  });
  return { ok: true };
}
