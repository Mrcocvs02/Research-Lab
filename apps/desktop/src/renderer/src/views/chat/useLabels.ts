import { useEffect, useState } from 'react';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';

/** Titles and names fetched for chips and lists, kept for the session (ids of different libraries never share a key). */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function load(key: string, fetcher: () => Promise<string | null>): Promise<string | null> {
  const known = cache.get(key);
  if (known !== undefined) return Promise.resolve(known);
  let p = inflight.get(key);
  if (!p) {
    p = fetcher()
      .catch(() => null)
      .then((v) => {
        cache.set(key, v);
        inflight.delete(key);
        return v;
      });
    inflight.set(key, p);
  }
  return p;
}

function useLabel(key: string | null, fetcher: () => Promise<string | null>): string | null {
  const [label, setLabel] = useState<string | null>(key ? (cache.get(key) ?? null) : null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    void load(key, fetcher).then((v) => live && setLabel(v));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return label;
}

/** The title of a document (null while unknown or when it has none). */
export function useDocTitle(docId: string | null): string | null {
  const lib = useApp().activeLibraryId ?? '';
  return useLabel(docId ? `${lib}/d/${docId}` : null, async () => (await rl.invoke('documents:get', { docId: docId! })).title ?? null);
}

export function useProjectName(id: string | null): string | null {
  const lib = useApp().activeLibraryId ?? '';
  return useLabel(id ? `${lib}/p/${id}` : null, async () => (await rl.invoke('projects:get', { id: id! })).project.name);
}

/** Forgets what was fetched (tests). */
export function clearLabels(): void {
  cache.clear();
  inflight.clear();
}
