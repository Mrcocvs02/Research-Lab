import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lazy, lazyView } from '../components/Lazy';
import { useAiUi } from '../lib/aiUi';
import { useShortcut } from '../lib/keymap';
import { useReader } from '../lib/reader';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';

// The banner (and the Banner component with it) loads only in the rare case it is shown.
const ResumeBanner = lazyView(() => import('./ResumeBanner'), []);

/** Seconds the reader rests on a page before the position is written (reading goes on, no write per page turn). */
const REST_MS = 4000;

/**
 * "Resume" (25, D-414), the part that is always there: it records where the reader is (only while a document is open),
 * answers Ctrl+Shift+R, and after an unclean close shows the one banner. No banner in a normal start. The reader itself is
 * not touched: the document and page it already publishes for the chat are what this reads.
 */
export function ShellResume() {
  const { t } = useTranslation();
  const app = useApp();
  const { reader } = useAiUi();
  const { openReader } = useReader();
  const [unclean, setUnclean] = useState<{ docId: string; title: string | null; page: number | null } | null>(null);
  const last = useRef<{ docId: string; page: number } | null>(null);

  // The document changed (or the reader opened): written at once, so that the open mark exists from the first moment.
  const docId = reader?.docId ?? null;
  useEffect(() => {
    if (!docId) return;
    void rl.invoke('resume:record', { docId, ...(last.current?.docId === docId ? { page: last.current.page } : reader?.page ? { page: reader.page } : {}) }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);
  // The page changed: written after a rest on it.
  const page = reader?.page;
  useEffect(() => {
    if (!docId || !page) return;
    last.current = { docId, page };
    const id = setTimeout(() => void rl.invoke('resume:record', { docId, page }).catch(() => {}), REST_MS);
    return () => clearTimeout(id);
  }, [docId, page]);
  // The reader closed: the last page is written and the open mark goes.
  const was = useRef<{ docId: string; page: number } | null>(null);
  useEffect(() => {
    if (reader) was.current = { docId: reader.docId, page: reader.page ?? last.current?.page ?? 1 };
    else if (was.current) {
      const w = was.current;
      was.current = null;
      void rl.invoke('resume:record', { docId: w.docId, page: w.page, closed: true }).catch(() => {});
    }
  }, [reader]);

  const library = app.activeLibraryId;
  useEffect(() => {
    if (!library) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The library may still be opening at start: a few more tries, two seconds apart.
    const ask = (left: number) =>
      rl.invoke('resume:get', {}).then(
        (r) => live && setUnclean(r.unclean),
        () => {
          if (live && left > 0) timer = setTimeout(() => ask(left - 1), 2000);
        },
      );
    void ask(4);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [library]);

  useShortcut('resume.open', () => {
    if (!library) return;
    void rl.invoke('resume:get', {}).then((r) => r.last && openReader(r.last.docId, r.last.page ?? undefined), () => {});
  });

  if (!unclean) return null;
  return (
    <Lazy>
      <ResumeBanner
        title={unclean.title}
        page={unclean.page}
        onResume={() => (setUnclean(null), openReader(unclean.docId, unclean.page ?? undefined))}
        onClose={() => setUnclean(null)}
      />
    </Lazy>
  );
}
