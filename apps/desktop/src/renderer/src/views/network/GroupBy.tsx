import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Lazy, lazyView } from '../../components/Lazy';
import { familyLabel, NONE_FAMILY, useFamily, type FamilyInfo } from './grouping';

const FamilyNamesDialog = lazyView(() => import('./FamilyNamesDialog'), ['network', 'projects']);
type Scope = RequestOf<Channels, 'graph:nameFamily'>['scope'];

/** Share of the papers that sit in a clear value of a family that did not pass the test (section 19.2.2), in percent. */
export const clearShare = (f: Pick<FamilyInfo, 'reason'>): number => (f.reason ? Math.round(100 * f.reason.coverage * f.reason.clarity) : 0);

/**
 * "Group by: Topic | Group | Method | Automatic | None" (section 19.2.2), in the bar of the Map: the family whose values are the blocks.
 * A family that does not pass the test stays in the menu, off, with the reason; the one chosen is shown under the control when it is off.
 */
export function GroupBy({ families, scope, withNone = false }: { families: readonly FamilyInfo[]; scope?: Scope; /** The Map offers "None" (the free layout); the networks do not. */ withNone?: boolean }) {
  const { t } = useTranslation();
  const [family, setFamily] = useFamily();
  const [naming, setNaming] = useState(false);
  const shown = family === NONE_FAMILY || families.some((f) => f.id === family) ? families : [...families, { id: family, label: family, count: 0 }];
  const current = families.find((f) => f.id === family);
  return (
    <>
      <label className="group-by">
        <span className="group-by-label">{t('network.group.by')}</span>
        <select value={family} onChange={(e) => setFamily(e.target.value)} data-testid="map-group-by">
          {shown.map((f) => (
            <option key={f.id} value={f.id} disabled={f.eligible === false} title={f.eligible === false ? t('network.blocks.reason', { pct: clearShare(f) }) : undefined}>
              {familyLabel(t, f)}
              {f.eligible === false ? ` · ${clearShare(f)} %` : ''}
            </option>
          ))}
          {withNone && <option value={NONE_FAMILY}>{t('network.group.noneBlocks')}</option>}
        </select>
      </label>
      {current?.eligible === false && (
        <span className="hint group-reason" data-testid="map-group-reason">
          {t('network.blocks.reason', { pct: clearShare(current) })}
        </span>
      )}
      {family === 'auto' && (
        <Button size="sm" onClick={() => setNaming(true)} data-testid="map-group-name">
          {t('network.group.nameButton')}
        </Button>
      )}
      {naming && (
        <Lazy>
          <FamilyNamesDialog scope={scope} onClose={() => setNaming(false)} />
        </Lazy>
      )}
    </>
  );
}

/** The visible label "Grouped by X", shown by the networks whenever a family other than the topic is on. */
export function GroupLabel({ families, family }: { families: readonly FamilyInfo[]; family: string }) {
  const { t } = useTranslation();
  const f = families.find((x) => x.id === family) ?? { id: family, label: family };
  return (
    <span className="hint group-label" data-testid="group-label" aria-live="polite">
      {t('network.group.grouped', { name: familyLabel(t, f) })}
    </span>
  );
}
