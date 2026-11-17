import { useEffect, useState } from 'react';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';

const MAX_FOLDERS = 400;

/** Folders of the library a file can be copied to (breadth first, capped), without the excluded ones. */
export function useFolderOptions(): string[] {
  const { config, activeLibraryId } = useApp();
  const [folders, setFolders] = useState<string[]>([]);
  const excluded = config?.excludedFolders;
  useEffect(() => {
    if (!activeLibraryId) return;
    let live = true;
    void (async () => {
      const out: string[] = [];
      const skip = (p: string) => (excluded ?? []).some((x) => p === x || p.startsWith(`${x}/`));
      const queue = [''];
      try {
        while (queue.length > 0 && out.length < MAX_FOLDERS) {
          const parent = queue.shift()!;
          const r = await rl.invoke('library:listFolders', { libraryId: activeLibraryId, ...(parent ? { parent } : {}) });
          for (const f of r.folders) {
            if (skip(f.path)) continue;
            out.push(f.path);
            if (f.hasChildren) queue.push(f.path);
          }
        }
      } catch {
        /* the select keeps what was found */
      }
      if (live) setFolders(out.sort());
    })();
    return () => {
      live = false;
    };
  }, [activeLibraryId, excluded]);
  return folders;
}
