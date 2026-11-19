import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalFlag } from '../../lib/useLocalFlag';
import { safeText } from '../library/safeText';
import { AREA_TINTS } from './colors';
import { useNav } from '../../lib/nav';
import { OTHER, OTHER_CLUSTER_ID, areaFallback, type AreaDef } from './areaColors';
import { Pill } from './NetChrome';

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
  /** Heading when the colours come from a grouping family ("Grouped by X"); the macro-area one otherwise. */
  title?: string | undefined;
}

const token = (slot: number): string => `var(--area-${slot < AREA_TINTS ? slot + 1 : 'other'})`;

/**
 * Legend of the macro-areas (section 18.3.6): up to seven rows (dot, name, count), "other areas" and "no tags", and the strip
 * from full to faint. Hovering a row lights its area; a click isolates it (second click or Esc releases it).
 */
export function AreaLegend({ defs, slots, without, onLight, onIsolate, title }: Props) {
  const { t } = useTranslation();
  const [iso, setIso] = useState<number | null>(null);
  // The legend sits over the drawing: it can be folded to its title (D-491), a per-viewer convenience.
  const [open, setOpen] = useLocalFlag('rl.map.legendOpen', true);
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
  const shown = defs.map((d, i) => ({ d, i })).filter(({ i }) => (slots[i] !== OTHER || !!defs[i]?.color || defs[i]?.id === OTHER_CLUSTER_ID));
  const rest = defs.map((d, i) => ({ d, i })).filter(({ i }) => (slots[i] === OTHER && !defs[i]?.color && defs[i]?.id !== OTHER_CLUSTER_ID));
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
    <ul className="legend area-legend" data-testid="area-legend" aria-label={title ?? t('network.area.areaLegend')}>
      <li className="legend-title hint">
        <button type="button" className="legend-fold" aria-expanded={open} onClick={() => setOpen(!open)} title={open ? t('network.area.legendHide') : t('network.area.legendShow')} data-testid="area-legend-fold">
          <span aria-hidden="true">{open ? '▾' : '▸'}</span> {title ?? t('network.area.areaLegend')}
        </button>
      </li>
      {open && shown.map(({ d, i }) => row(d, i, 'area-item', d.color ?? token(slots[i]!)))}
      {open && rest.length > 0 && (
        <li className="hint legend-more" data-testid="area-other" title={rest.map(({ d }) => safeText(d.label)).join(', ')}>
          <span className="rl-swatch area-dot" style={{ background: token(OTHER) }} aria-hidden="true" /> {t('network.area.areaOther', { count: rest.length })}
        </li>
      )}
      {open && without > 0 && (
        <li className="hint legend-more" data-testid="area-none">
          <span className="rl-swatch area-dot area-ring" aria-hidden="true" /> {t('network.area.areaNone')}
        </li>
      )}
      {open && (
      <li className="legend-key hint" aria-hidden="false">
        <span className="area-strip" aria-hidden="true" />
        <span>{t('network.area.areaKey')}</span>
      </li>
      )}
    </ul>
  );
}

/**
 * The note of the colour fallbacks (section 18.3.6) for the views that draw the network: no tag (or one area only) -> the topics colour
 * the nodes; few nodes with an area -> areas, with the way back to topics. Null when nothing needs saying.
 */
export function AreaNote({ testId, defs, withArea, total, onTopics }: { testId: string; defs: readonly AreaDef[] | undefined; withArea: number; total: number; onTopics(): void }) {
  const { t } = useTranslation();
  const nav = useNav();
  const fb = areaFallback(defs, withArea, total);
  if (fb.use === 'topics') {
    return (
      <Pill testId={testId}>
        {t(fb.reason === 'single' ? 'network.area.areaSingle' : 'network.area.areaNoTags')}
        {fb.reason !== 'single' && (
          <button type="button" className="link" onClick={() => nav.navigate({ view: 'settings' })}>
            {t('network.area.manageTags')}
          </button>
        )}
      </Pill>
    );
  }
  if (fb.sparse === undefined) return null;
  return (
    <Pill testId={testId}>
      {t('network.area.areaSparse', { count: fb.sparse })}
      <button type="button" className="link" onClick={onTopics}>
        {t('network.area.areaByTopic')}
      </button>
    </Pill>
  );
}
