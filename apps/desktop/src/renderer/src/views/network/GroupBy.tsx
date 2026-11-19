import { useTranslation } from 'react-i18next';
import { familyLabel, useFamily, type FamilyInfo } from './grouping';

/** "Group by: Topic | Group | Method | ..." (§18.3.7): the family that colours and pulls the nodes of the Map together. */
export function GroupBy({ families }: { families: readonly FamilyInfo[] }) {
  const { t } = useTranslation();
  const [family, setFamily] = useFamily();
  const shown = families.some((f) => f.id === family) ? families : [...families, { id: family, label: family, count: 0 }];
  return (
    <label className="net-field net-pop-row">
      <span>{t('network.group.by')}</span>
      <select value={family} onChange={(e) => setFamily(e.target.value)} data-testid="map-group-by">
        {shown.map((f) => (
          <option key={f.id} value={f.id}>
            {familyLabel(t, f)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The visible label "Grouped by X", shown whenever a family other than the topic is on. */
export function GroupLabel({ families, family }: { families: readonly FamilyInfo[]; family: string }) {
  const { t } = useTranslation();
  const f = families.find((x) => x.id === family) ?? { id: family, label: family };
  return (
    <span className="hint group-label" data-testid="group-label" aria-live="polite">
      {t('network.group.grouped', { name: familyLabel(t, f) })}
    </span>
  );
}
