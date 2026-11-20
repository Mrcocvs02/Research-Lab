import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, RequestOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Lazy, lazyView } from '../../components/Lazy';
import { clearShare, familyLabel, isPartial, NONE_FAMILY, offerFamilies, useFamily, type FamilyInfo } from './grouping';

const FamilyNamesDialog = lazyView(() => import('./FamilyNamesDialog'), ['network', 'projects']);
type Scope = RequestOf<Channels, 'graph:nameFamily'>['scope'];

/** "Name with Claude" for the Automatic groups: the button, and the dialog it opens (the caller owns the state: below 1440 px the button sits in a popover, D-508). */
export function NameFamilyButton({ onClick }: { onClick(): void }) {
  const { t } = useTranslation();
  return (
    <Button size="sm" onClick={onClick} data-testid="map-group-name">
      {t('network.group.nameButton')}
    </Button>
  );
}
export function NameFamilyDialog({ scope, onClose }: { scope?: Scope; onClose(): void }) {
  return (
    <Lazy>
      <FamilyNamesDialog scope={scope} onClose={onClose} />
    </Lazy>
  );
}

/**
 * "Group by: Topic | Group | Method | Automatic | None" (section 19.2.2), in the bar of the Map: the family whose values are the blocks.
 * A family that does not pass the test stays choosable (with its percentage); the strip says that its blocks are partial (D-499).
 */
export function GroupBy({ families, scope, withNone = false, nameInBar = true, onTidy }: { families: readonly FamilyInfo[]; scope?: Scope; /** The Map offers "None" (the free layout); the networks do not. */ withNone?: boolean; /** The "Name with Claude" button of Automatic stays in the bar (false: the caller puts it elsewhere). */ nameInBar?: boolean; /** "Tidy the tags" opens the tag cleanup. */ onTidy?(): void }) {
  const { t } = useTranslation();
  const [family, setFamily] = useFamily();
  const [naming, setNaming] = useState(false);
  const offered = offerFamilies(families, family);
  const shown = family === NONE_FAMILY || offered.some((f) => f.id === family) ? offered : [...offered, { id: family, label: family, count: 0 }];
  const current = families.find((f) => f.id === family);
  return (
    <>
      <label className="group-by">
        <span className="group-by-label">{t('network.group.by')}</span>
        <select value={family} onChange={(e) => setFamily(e.target.value)} data-testid="map-group-by">
          {shown.map((f) => (
            <option key={f.id} value={f.id} title={f.eligible === false ? t('network.blocks.reason', { pct: clearShare(f) }) : undefined}>
              {familyLabel(t, f)}
              {f.eligible === false ? ` · ${clearShare(f)} %` : ''}
            </option>
          ))}
          {withNone && <option value={NONE_FAMILY}>{t('network.group.noneBlocks')}</option>}
        </select>
      </label>
      {isPartial(current) && (
        <span className="hint group-reason" data-testid="map-group-reason">
          {t('network.blocks.partial', { name: familyLabel(t, current), pct: clearShare(current) })}
          {onTidy && (
            <>
              {' '}
              <button type="button" className="link" onClick={onTidy} data-testid="map-group-tidy">
                {t('network.area.tidyTags')}
              </button>
            </>
          )}
        </span>
      )}
      {family === 'auto' && nameInBar && <NameFamilyButton onClick={() => setNaming(true)} />}
      {naming && <NameFamilyDialog scope={scope} onClose={() => setNaming(false)} />}
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
