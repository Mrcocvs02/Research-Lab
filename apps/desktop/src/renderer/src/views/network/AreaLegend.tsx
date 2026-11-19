import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalFlag } from '../../lib/useLocalFlag';
import { safeText } from '../library/safeText';
import { AREA_TINTS } from './colors';
import { OTHER, type AreaDef } from './areaColors';

/** Whether nodes are coloured by macro-area (true, the default) or by topic (D-483), remembered as a per-viewer convenience. */
export const useAreaColors = (): [boolean, (v: boolean) => void] => useLocalFlag('rl.map.areaColors', true);

interface Props {
  defs: readonly AreaDef[];
  slots: readonly number[];
  /** Nodes without any area (shown as an empty ring). */
  without: number;
  onLight(area: number | null): void;
  /** The area kept alone (the others fade), or null. */
  onIsolate(area: number | null): void;
}

const token = (slot: number): string => `var(--area-${slot < AREA_TINTS ? slot + 1 : 'other'})`;

/**
 * Legend of the macro-areas (section 18.3.6): up to seven rows (dot, name, count), "other areas" and "no tags", and the strip
 * from full to faint. Hovering a row lights its area; a click isolates it (second click or Esc releases it).
 */
export function AreaLegend({ defs, slots, without, onLight, onIsolate }: Props) {
  const { t } = useTranslation();
  const [iso, setIso] = useState<number | null>(null);
  useEffect(() => {
    if (iso === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIso(null);
        onIsolate(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [iso, onIsolate]);
  const shown = defs.map((d, i) => ({ d, i })).filter(({ i }) => slots[i] !== OTHER);
  const rest = defs.map((d, i) => ({ d, i })).filter(({ i }) => slots[i] === OTHER);
  const row = (d: AreaDef, i: number, testId: string, color: string) => (
    <li key={d.id}>
      <button
        type="button"
        className="legend-item"
        title={safeText(d.label)}
        aria-pressed={iso === i}
        data-testid={testId}
        data-area={d.id}
        onMouseEnter={() => onLight(i)}
        onMouseLeave={() => onLight(null)}
        onFocus={() => onLight(i)}
        onBlur={() => onLight(null)}
        onClick={() => {
          const next = iso === i ? null : i;
          setIso(next);
          onIsolate(next);
        }}
      >
        <span className="rl-swatch area-dot" style={{ background: color }} aria-hidden="true" />
        <span className="legend-text">{safeText(d.label)}</span>
        <span className="hint">{d.count}</span>
      </button>
    </li>
  );
  return (
    <ul className="legend area-legend" data-testid="area-legend" aria-label={t('network.area.areaLegend')}>
      <li className="legend-title hint">{t('network.area.areaLegend')}</li>
      {shown.map(({ d, i }) => row(d, i, 'area-item', token(slots[i]!)))}
      {rest.length > 0 && (
        <li className="hint legend-more" data-testid="area-other" title={rest.map(({ d }) => safeText(d.label)).join(', ')}>
          <span className="rl-swatch area-dot" style={{ background: token(OTHER) }} aria-hidden="true" /> {t('network.area.areaOther', { count: rest.length })}
        </li>
      )}
      {without > 0 && (
        <li className="hint legend-more" data-testid="area-none">
          <span className="rl-swatch area-dot area-ring" aria-hidden="true" /> {t('network.area.areaNone')}
        </li>
      )}
      <li className="legend-key hint" aria-hidden="false">
        <span className="area-strip" aria-hidden="true" />
        <span>{t('network.area.areaKey')}</span>
      </li>
    </ul>
  );
}
