import { useCallback } from 'react';
import { setLibraryIntent } from '../../lib/libraryIntent';
import { useNav } from '../../lib/nav';
import { rl } from '../../lib/rl';
import type { EntityMode, EntityNode } from './entityTypes';

/** The documents one topic can carry into a Library filter (the filter holds at most 500 ids; a topic with more needs the `topic` filter of N4). */
export const LIBRARY_IDS = 500;

/**
 * "Open in the Library" (§4.21.4): a tag opens the Library with the tag included, an author with the Authors facet (every form
 * of the name), a topic with its documents. The Library reads the intent when it mounts.
 */
export function useOpenInLibrary(mode: EntityMode): (n: EntityNode) => void {
  const nav = useNav();
  return useCallback(
    (n: EntityNode) => {
      const go = (intent: Parameters<typeof setLibraryIntent>[0]) => {
        setLibraryIntent(intent);
        nav.navigate({ view: 'library' });
      };
      if (mode === 'tag') go({ tags: [n.id] });
      else if (mode === 'author') go({ authors: n.variants && n.variants.length > 0 ? n.variants : [n.label] });
      else {
        rl.invoke('graph:map', {}).then(
          (m) => go({ docIds: m.points.filter((p) => p.clusters.includes(n.id)).slice(0, LIBRARY_IDS).map((p) => p.docId) }),
          () => go(null),
        );
      }
    },
    [mode, nav],
  );
}
