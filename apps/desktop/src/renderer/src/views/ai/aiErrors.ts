import type { TFunction } from 'i18next';
import { errorMessage } from '../../lib/errors';
import { RlError } from '../../lib/rl-error';

/** Clear text for the refusals of an AI send (no access, offline, cap, folder not enabled); other errors as usual. */
export function aiErrorText(error: unknown, t: TFunction): string {
  const err = RlError.from(error);
  if (err.code === 'AI_PROVIDER_ERROR') {
    const reason = err.details?.reason;
    if (reason === 'no-access') return t('chat.errors.noAccess');
    if (reason === 'offline') return t('chat.errors.offline');
  }
  if (err.code === 'CONFLICT' && err.details?.reason === 'turn-running') return t('chat.errors.turnRunning');
  if (err.code === 'AI_BUDGET_EXCEEDED') return t('chat.errors.cap');
  if (err.code === 'FOLDER_NOT_AI_ENABLED') return t('errors.FOLDER_NOT_AI_ENABLED');
  return errorMessage(error, t);
}
