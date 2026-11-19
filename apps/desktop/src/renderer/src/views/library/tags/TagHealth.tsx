import { useTranslation } from 'react-i18next';
import type { TagHealthItem } from '@rl/core';
import { Button } from '../../../components/Button';
import { healthChips, healthTarget, type HealthTarget } from './tagHealthModel';

/** The health strip at the top of the tag manager (D-494): one chip per check with its count, neutral under the threshold; a click opens the list or the tree behind it. */
export function TagHealth({ health, onOpen, onCleanup }: { health: readonly TagHealthItem[]; onOpen(target: HealthTarget): void; onCleanup(): void }) {
  const { t } = useTranslation();
  return (
    <div className="tag-health" data-testid="tag-health" role="group" aria-label={t('tax.health.title')}>
      {healthChips(health).map((h) => (
        <button
          key={h.kind}
          type="button"
          className={h.flagged && h.count > 0 ? 'tag-health__chip is-flagged' : 'tag-health__chip'}
          title={t(`tax.health.hint.${h.kind}`)}
          onClick={() => onOpen(healthTarget(h))}
          data-testid={`tag-health-chip-${h.kind}`}
          data-flagged={h.flagged && h.count > 0}
        >
          {t(`tax.health.chip.${h.kind}`)} <b>{h.count}</b>
        </button>
      ))}
      <Button size="sm" onClick={onCleanup} data-testid="tag-cleanup-open">
        {t('tax.cleanup.open')}
      </Button>
    </div>
  );
}
