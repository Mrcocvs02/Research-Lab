import { useEffect, useState } from 'react';
import { useChangeVersion } from '../lib/events';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';

/**
 * Documents with a proposal of Claude waiting (the dot of the "To review" entry, D-358): one local read (`review:stats`)
 * a moment after the window is shown, again when an AI job ends and, quietly, after the documents change (decisions in the
 * review, tags). Never a network request, and nothing on the way to the first paint.
 */
export function useReviewDocs(): number {
  const { activeLibraryId } = useApp();
  const documents = useChangeVersion('documents');
  const [n, setN] = useState(0);
  useEffect(() => setN(0), [activeLibraryId]);
  useEffect(() => {
    if (!activeLibraryId) return;
    let live = true;
    const load = () =>
      rl.invoke('review:stats', {}).then(
        (r) => live && setN(r.pendingDocs),
        () => {},
      );
    const timer = setTimeout(() => void load(), documents === 0 ? 2500 : 1500);
    const off = rl.on('jobs:progress', (s) => {
      if (s.state !== 'queued' && s.state !== 'running') void load();
    });
    return () => {
      live = false;
      clearTimeout(timer);
      off();
    };
  }, [activeLibraryId, documents]);
  return n;
}
