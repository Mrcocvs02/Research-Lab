import { useTranslation } from 'react-i18next';
import type { ScanStatus } from '@rl/core';

/** One-line description of the scan state, for the status bar and the library view. */
export function scanText(status: ScanStatus | null, t: ReturnType<typeof useTranslation>['t']): string {
  if (!status) return '';
  if (status.state === 'running') {
    switch (status.phase) {
      case 'extracting':
        return t('scan.extracting', { processed: status.processed, total: status.total ?? 0 });
      case 'indexing':
        return t('scan.indexing', { processed: status.processed, total: status.total ?? 0 });
      case 'hashing':
        return status.total !== undefined ? t('scan.hashingTotal', { seen: status.seen, total: status.total }) : t('scan.hashing', { seen: status.seen });
      default:
        return t('scan.walking', { seen: status.seen });
    }
  }
  if (status.state === 'failed') return t('scan.failed');
  if (status.state === 'cancelled') return t('scan.cancelled');
  if (status.state === 'done') return t('scan.done', { count: status.indexed });
  return t('scan.idle', { count: status.indexed });
}
