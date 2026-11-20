import type { ReactNode } from 'react';
import type { MenuItem } from '../../../components/Menu';
import type { BlockView } from '../blocksDraw';
import type { EvEdge } from '../edges';

/**
 * The contract of `useMapExtras` (`views/network/mapExtras.tsx`, section 20.10), which the reading and gaps task writes beside this one. This file
 * stands in for it while that module is not on the branch: `MapPanel` imports from here, and the merge switches that one import to `./mapExtras`
 * and deletes this file. It does nothing: no marks, no sections, no filters.
 */
export interface MapExtrasInput {
  blocks: BlockView | null;
  evidence: readonly EvEdge[];
  selected: string | null;
  multi: ReadonlySet<string>;
  family: string;
  scope: { folder?: string | undefined; projectId?: string | undefined; tagId?: string | undefined } | undefined;
  onFly(docId: string): void;
  onSelect(docId: string | null): void;
  onSelectMany(docIds: string[]): void;
}
export interface MapExtras {
  allow?: ReadonlySet<string> | null;
  st: Map<string, 1 | 2>;
  isolated: ReadonlySet<string>;
  sideSections: ReactNode;
  filterRows: ReactNode;
  moreItems: MenuItem[];
  paperItems(docId: string): MenuItem[];
  nextToRead(from: string[] | null): void;
}

const NONE: MapExtras = { allow: null, st: new Map(), isolated: new Set(), sideSections: null, filterRows: null, moreItems: [], paperItems: () => [], nextToRead: () => undefined };
export function useMapExtras(_input: MapExtrasInput): MapExtras {
  return NONE;
}
