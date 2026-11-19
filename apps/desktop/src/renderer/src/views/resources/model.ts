import type { ResourceKind } from '@rl/core';
import { RlError } from '../../lib/rl-error';

/** A kind to start from, guessed from the address (the user can change it). */
export function guessKind(address: string): Exclude<ResourceKind, 'reference'> {
  let host = '';
  let path = '';
  try {
    const u = new URL(address.includes('://') ? address : `https://${address}`);
    host = u.hostname.toLowerCase().replace(/^www\./, '');
    path = u.pathname.toLowerCase();
  } catch {
    return 'web';
  }
  if (path.endsWith('.ipynb') || host === 'colab.research.google.com' || host === 'nbviewer.org' || host === 'mybinder.org') return 'notebook';
  if (['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', 'huggingface.co', 'sr.ht'].includes(host) || host.startsWith('git.')) return 'code';
  if (['zenodo.org', 'figshare.com', 'osf.io', 'kaggle.com', 'datadryad.org', 'dataverse.harvard.edu', 'data.mendeley.com'].includes(host) || host.endsWith('.dataverse.org')) return 'data';
  return 'web';
}

/** One glyph per kind: no colour of its own (17.4.4); the kind is also written next to it. */
export const KIND_GLYPH: Record<ResourceKind, string> = { code: '⌘', data: '▦', web: '◎', notebook: '◫', folder: '▤', reference: '○' };

/** What an "Open" failure says: a refused kind of file is not a broken link. */
export function openFailure(e: unknown, t: (k: string) => string): string {
  return RlError.from(e).code === 'PERMISSION_DENIED' ? t('resources.openRefused') : t('resources.openFailed');
}
