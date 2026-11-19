import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Kbd } from '../../components/Kbd';
import { ChipPop } from './NetChrome';
import { useApp } from '../../state/app-context';
import { EntityNet, type EmptyKind } from './EntityNet';
import type { EntityNetwork, EntityNode, NetMode } from './entityTypes';
import { MODES } from './entityTypes';
import { GraphNet, type NetStart } from './GraphNet';
import type { NetCtl } from './NetworkView';
import { mapAction } from './mapKeyboard';
import type { ScopeOptions } from './useScopes';

/** The mode of each library for the session (§4.21: remembered per library). */
const modeOf = new Map<string, NetMode>();

interface Props {
  active: boolean;
  onCtl(c: NetCtl | null): void;
  start: NetStart | null;
  scopes: ScopeOptions;
  selectedDoc: string | null;
  selectedDocLabel: string | null;
  selectedEntityId: string | null;
  onSelectDoc(docId: string): void;
  onSelectEntity(node: EntityNode | null, mode: Exclude<NetMode, 'doc'>): void;
  onData(d: EntityNetwork | null): void;
  onStart(start: Omit<NetStart, 'nonce'>): void;
  /** `L`: Explore on the dimension of the mode. */
  onExplore(dim: 'topic' | 'author'): void;
  onEmpty(kind: EmptyKind): void;
  mapVersion: number;
  mapReady: boolean;
}

/**
 * The Links tab: one control for the mode ("Network of: Documents, Tags, Topics, Authors", `M` for the next), then the network
 * of documents or of entities. Only the mode shown is mounted; the mode is kept per library for the session.
 */
export function LinksPanel({ active, onCtl, start, scopes, selectedDoc, selectedDocLabel, selectedEntityId, onSelectDoc, onSelectEntity, onData, onStart, onExplore, onEmpty, mapVersion, mapReady }: Props) {
  const { t } = useTranslation();
  const lib = useApp().activeLibraryId ?? '';
  const [mode, setModeState] = useState<NetMode>(() => modeOf.get(lib) ?? 'doc');
  const box = useRef<HTMLDivElement>(null);
  const setMode = (m: NetMode) => {
    modeOf.set(lib, m);
    setModeState(m);
    if (m === 'doc') onData(null);
  };
  /** `M` goes to the next mode, from the canvas or the toolbar (not while typing in a field). */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
    if (mapAction(e)?.type !== 'mode') return;
    e.preventDefault();
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]!);
    // The canvas of the old mode goes away with the focus on it: the panel keeps it, so that M keeps working.
    requestAnimationFrame(() => {
      if (!box.current?.contains(document.activeElement)) box.current?.focus({ preventScroll: true });
    });
  };

  const chip = <ModeChip mode={mode} onChange={setMode} />;
  return (
    <div className="links-panel" ref={box} tabIndex={-1} style={{ outline: 'none' }} onKeyDown={onKeyDown} data-testid="links-panel" data-mode={mode}>
      {mode === 'doc' ? (
        <GraphNet active={active} modeChip={chip} start={start} scopes={scopes} selectedDoc={selectedDoc} selectedDocLabel={selectedDocLabel} onSelectDoc={onSelectDoc} onStart={onStart} onExplore={() => onExplore('topic')} onCtl={onCtl} />
      ) : (
        <EntityNet
          key={mode}
          active={active}
          modeChip={chip}
          mode={mode}
          scopes={scopes}
          selectedId={selectedEntityId}
          onSelect={(n) => onSelectEntity(n, mode)}
          onSelectDoc={onSelectDoc}
          onExplore={() => onExplore(mode === 'author' ? 'author' : 'topic')}
          onEmpty={onEmpty}
          onData={onData}
          mapVersion={mapVersion}
          mapReady={mapReady}
        />
      )}
    </div>
  );
}

/** "Network of: Documents ▾": a menu of the four modes, each with a sentence, `M` written on the right. */
function ModeChip({ mode, onChange }: { mode: NetMode; onChange(m: NetMode): void }) {
  const { t } = useTranslation();
  return (
    <ChipPop label={t(`network.mode.${mode}`)} prefix={t('network.mode.label')} testId="net-mode" width={320}>
      {(close) => (
        <div role="menu" aria-label={t('network.mode.label')} className="mode-menu">
          {MODES.map((m) => (
            <button key={m} type="button" role="menuitemradio" aria-checked={m === mode} className={m === mode ? 'mode-item on' : 'mode-item'} onClick={() => (onChange(m), close())} data-testid={`net-mode-${m}`}>
              <span className="mode-name">{t(`network.mode.${m}`)}</span>
              <span className="hint">{t(`network.mode.${m}Sentence`)}</span>
            </button>
          ))}
          <div className="hint mode-key">
            <Kbd>M</Kbd> {t('network.mode.hint')}
          </div>
        </div>
      )}
    </ChipPop>
  );
}
