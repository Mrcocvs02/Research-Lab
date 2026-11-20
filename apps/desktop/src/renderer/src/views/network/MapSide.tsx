import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ResizeHandle } from '../../components/ResizeHandle';
import { Segmented } from '../../components/Segmented';
import { useResizable } from '../../lib/useResizable';
import { safeText } from '../library/safeText';
import { ChipPop } from './NetChrome';
import type { EdgeMode, EvFilter } from './edges';

/** The frame of the Map outside the canvas (D-498, section 19.2.6): a side column from 1440 px, a strip of one line above the canvas below it. */
export const WIDE_PX = 1440;

/** True when the window is at least 1440 px wide (the column is open by default). */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => window.innerWidth >= WIDE_PX);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= WIDE_PX);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return wide;
}

export type Strictness = 'strict' | 'normal' | 'wide';
const PERCENTILE: Record<Strictness, number> = { strict: 90, normal: 75, wide: 50 };

export interface SideBlock {
  id: string;
  label: string;
  count: number;
  /** Tint index: 0..6 the tints, 7 other values, 8 no value. */
  tint: number;
}
export interface EvidenceControls {
  mode: EdgeMode;
  setMode(m: EdgeMode): void;
  kinds: EvFilter;
  setKind(k: keyof EvFilter, on: boolean): void;
  strict: Strictness;
  setStrict(s: Strictness): void;
  /** The threshold of the library (null while it is not known). */
  tau: number | null;
}

const token = (tint: number): string => `var(--area-${tint < 7 ? tint + 1 : 'other'})`;

/** Mode of the edges, evidence chips and threshold of the library, with the count of papers. */
function Controls({ c, count }: { c: EvidenceControls; count: number }) {
  const { t, i18n } = useTranslation();
  const chip = (k: keyof EvFilter, testId: string, label: string) => (
    <button key={k} type="button" className={c.kinds[k] ? 'net-chip is-active' : 'net-chip'} aria-pressed={c.kinds[k]} onClick={() => c.setKind(k, !c.kinds[k])} data-testid={testId}>
      {label}
    </button>
  );
  return (
    <div className="map-controls">
      <div className="map-ctl" data-testid="map-edges-mode-box">
        <span className="map-ctl-title">{t('network.blocks.edges')}</span>
        <Segmented<EdgeMode>
          size="sm"
          label={t('network.blocks.edges')}
          value={c.mode}
          onChange={c.setMode}
          options={[
            { value: 'selected', label: t('network.blocks.edgesSelected'), testId: 'map-edges-selected' },
            { value: 'strong', label: t('network.blocks.edgesStrong'), testId: 'map-edges-strong' },
            { value: 'none', label: t('network.blocks.edgesNone'), testId: 'map-edges-none' },
          ]}
        />
        <span data-testid="map-edges-mode" className="visually-hidden">
          {c.mode}
        </span>
      </div>
      <div className="map-ctl">
        <span className="map-ctl-title">{t('network.blocks.evidence')}</span>
        <div className="map-chips">
          {chip('cites', 'map-ev-citations', t('network.blocks.evCites'))}
          {chip('linked', 'map-ev-links', t('network.blocks.evLinks'))}
          {chip('similar', 'map-ev-similar', t('network.blocks.evSimilar'))}
        </div>
      </div>
      <div className="map-ctl" data-testid="map-threshold">
        <span className="map-ctl-title">{c.tau === null ? t('network.blocks.threshold') : t('network.blocks.tau', { tau: c.tau.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), pct: PERCENTILE[c.strict] })}</span>
        <Segmented<Strictness>
          size="sm"
          label={t('network.blocks.threshold')}
          value={c.strict}
          onChange={c.setStrict}
          options={[
            { value: 'strict', label: t('network.blocks.strict'), testId: 'map-threshold-strict' },
            { value: 'normal', label: t('network.blocks.normal'), testId: 'map-threshold-normal' },
            { value: 'wide', label: t('network.blocks.wide'), testId: 'map-threshold-wide' },
          ]}
        />
      </div>
      <p className="hint map-count" data-testid="map-count">
        {t('network.blocks.count', { count })}
      </p>
    </div>
  );
}

/** The blocks as a list: dot, name, count; a click flies to the block and lights it. */
function BlockList({ blocks, onLight, onFly }: { blocks: readonly SideBlock[]; onLight(id: string | null): void; onFly(id: string): void }) {
  return (
    <ul className="map-blocklist" data-testid="map-blocklist">
      {blocks.map((b) => (
        <li key={b.id}>
          <button type="button" className="legend-item" title={safeText(b.label)} data-testid="map-block" data-value={b.id} data-count={b.count} onMouseEnter={() => onLight(b.id)} onMouseLeave={() => onLight(null)} onFocus={() => onLight(b.id)} onBlur={() => onLight(null)} onClick={() => onFly(b.id)}>
            <span className={b.tint === 8 ? 'rl-swatch area-dot area-ring' : 'rl-swatch area-dot'} style={b.tint === 8 ? undefined : { background: token(b.tint) }} aria-hidden="true" />
            <span className="legend-text">{safeText(b.label)}</span>
            <span className="hint">{b.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface FrameProps {
  /** The blocks of the family (empty with the free layout, where `legend` stands in). */
  blocks: readonly SideBlock[];
  legend: ReactNode;
  controls: EvidenceControls;
  count: number;
  onLight(id: string | null): void;
  onFly(id: string): void;
  /** More controls for the popover of the strip (the naming of Automatic below 1440 px). */
  extra?: ReactNode;
}

/**
 * The side column of 248 px (`map-side`): the blocks, the controls of the edges, the count and, at the bottom, the place of the minimap.
 * It folds into a bar of 40 px, which the caller remembers.
 */
export function MapSide({ open, onToggle, minimapRef, ...p }: FrameProps & { open: boolean; onToggle(): void; minimapRef(el: HTMLElement | null): void }) {
  const { t } = useTranslation();
  const w = useResizable('rl.w.mapSide', { def: 248, min: 220, max: 420 });
  return (
    <aside className={open ? 'map-side' : 'map-side is-folded'} style={open ? { width: w.width } : undefined} data-testid="map-side" aria-label={t('network.blocks.side')}>
      <button type="button" className="icon-button map-side-toggle" aria-expanded={open} aria-label={open ? t('network.blocks.sideHide') : t('network.blocks.sideShow')} title={open ? t('network.blocks.sideHide') : t('network.blocks.sideShow')} onClick={onToggle} data-testid="map-side-toggle">
        <span aria-hidden="true">{open ? '›' : '‹'}</span>
      </button>
      {open && <ResizeHandle r={w} edge="start" label={t('common.resizeMap')} testId="resize-map-side" />}
      {open && (
        <div className="map-side-body">
          {p.blocks.length > 0 ? <BlockList blocks={p.blocks} onLight={p.onLight} onFly={p.onFly} /> : p.legend}
          <Controls c={p.controls} count={p.count} />
          <div className="map-minislot" ref={minimapRef} />
        </div>
      )}
    </aside>
  );
}

/** The strip of one line above the canvas (below 1440 px): the blocks as scrolling chips, the controls in a popover. */
export function MapStrip(p: FrameProps) {
  const { t } = useTranslation();
  return (
    <div className="map-strip" data-testid="map-strip">
      {p.blocks.length > 0 ? (
        <ul className="map-strip-blocks" aria-label={t('network.blocks.side')}>
          {p.blocks.map((b) => (
            <li key={b.id}>
              <button type="button" className="net-chip map-strip-chip" title={safeText(b.label)} data-testid="map-block" data-value={b.id} data-count={b.count} onMouseEnter={() => p.onLight(b.id)} onMouseLeave={() => p.onLight(null)} onFocus={() => p.onLight(b.id)} onBlur={() => p.onLight(null)} onClick={() => p.onFly(b.id)}>
                <span className={b.tint === 8 ? 'rl-swatch area-dot area-ring' : 'rl-swatch area-dot'} style={b.tint === 8 ? undefined : { background: token(b.tint) }} aria-hidden="true" />
                <span>{safeText(b.label)}</span>
                <span className="hint"> {b.count}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="map-strip-blocks">{p.legend}</div>
      )}
      <ChipPop label={t('network.blocks.controls')} testId="map-strip-controls" width={320}>
        <div className="net-pop-body">
          {p.extra}
          <Controls c={p.controls} count={p.count} />
        </div>
      </ChipPop>
    </div>
  );
}
