import { useCallback } from 'react';
import { setLibraryIntent } from '../../lib/libraryIntent';
import { useNav } from '../../lib/nav';
import type { EntityNode } from './entityTypes';

/** "Open in the Library" (§4.21.4): an author opens the Library with the Authors facet (every form of the name). The Library reads the intent when it mounts. */
export function useOpenInLibrary(): (n: EntityNode) => void {
  const nav = useNav();
  return useCallback(
    (n: EntityNode) => {
      setLibraryIntent({ authors: n.variants && n.variants.length > 0 ? n.variants : [n.label] });
      nav.navigate({ view: 'library' });
    },
    [nav],
  );
}
