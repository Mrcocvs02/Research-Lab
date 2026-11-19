import { GraphNet, type NetStart } from './GraphNet';
import type { NetCtl } from './NetworkView';

interface Props {
  active: boolean;
  onCtl(c: NetCtl | null): void;
  /** The centre of the neighbourhood. */
  start: NetStart | null;
  selectedDoc: string | null;
  selectedDocLabel: string | null;
  onSelectDoc(docId: string): void;
  onStart(start: Omit<NetStart, 'nonce'>): void;
  /** `L`: Explore. */
  onExplore(dim: 'topic' | 'author'): void;
  /** Centres visited (document ids, oldest first) for the crumbs. */
  crumbs: readonly string[];
  onCenter(docId: string, label: string): void;
  onPath(a: string, b: string): void;
}

/**
 * The Neighbourhood tab (section 19.2.5): the papers around one paper, nothing else. The networks of tags and topics are gone (the
 * vocabulary is a tree in Explore, section 19.2.7) and the one of the authors lives in Explore too.
 */
export function LinksPanel({ active, onCtl, start, selectedDoc, selectedDocLabel, onSelectDoc, onStart, onExplore, crumbs, onCenter, onPath }: Props) {
  return (
    <div className="links-panel" data-testid="links-panel" data-mode="doc">
      <GraphNet active={active} start={start} selectedDoc={selectedDoc} selectedDocLabel={selectedDocLabel} onSelectDoc={onSelectDoc} onStart={onStart} onExplore={() => onExplore('topic')} onCtl={onCtl} crumbs={crumbs} onCenter={onCenter} onPath={onPath} />
    </div>
  );
}
