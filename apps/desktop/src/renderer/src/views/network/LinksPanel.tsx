import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '../../components/Segmented';
import { useApp } from '../../state/app-context';
import { EntityNet, type EmptyKind } from './EntityNet';
import type { EntityNetwork, EntityNode, NetMode } from './entityTypes';
import { MODES } from './entityTypes';
import { GraphNet, type NetStart } from './GraphNet';
import { mapAction } from './mapKeyboard';
import type { ScopeOptions } from './useScopes';

/** The mode of each library for the session (§4.21: remembered per library). */
const modeOf = new Map<string, NetMode>();

interface Props {
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
export function LinksPanel({ start, scopes, selectedDoc, selectedDocLabel, selectedEntityId, onSelectDoc, onSelectEntity, onData, onStart, onExplore, onEmpty, mapVersion, mapReady }: Props) {
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
  };

  return (
    <div className="links-panel" ref={box} onKeyDown={onKeyDown} data-testid="links-panel" data-mode={mode}>
      <div className="net-toolbar mode-bar">
        <span className="mode-label">{t('network.mode.label')}</span>
        <Segmented<NetMode>
          label={t('network.mode.label')}
          value={mode}
          onChange={setMode}
          options={MODES.map((m) => ({ value: m, label: t(`network.mode.${m}`), testId: `net-mode-${m}` }))}
        />
        <span className="hint">{t('network.mode.hint')}</span>
      </div>
      {mode === 'doc' ? (
        <GraphNet start={start} scopes={scopes} selectedDoc={selectedDoc} selectedDocLabel={selectedDocLabel} onSelectDoc={onSelectDoc} onStart={onStart} onExplore={() => onExplore('topic')} />
      ) : (
        <EntityNet
          key={mode}
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
