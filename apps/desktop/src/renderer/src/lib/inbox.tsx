import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { useApp } from '../state/app-context';
import { useAiUi } from './aiUi';
import { useLibraryEvents } from './events';
import { useNotify } from './notify';
import { rl } from './rl';

type AddResult = ResponseOf<Channels, 'inbox:add'>;
export type InboxRefusal = AddResult['refused'][number];

interface InboxValue {
  /** Items waiting in the inbox (badge of the navigation). */
  count: number;
  /** A file is being dragged over the window (shows the drop hint). */
  dragging: boolean;
  /** Files the last add refused, with the reason. */
  refused: InboxRefusal[];
  clearRefused(): void;
  /** Adds PDFs chosen with the dialog of the main process. */
  choose(): Promise<void>;
}

const NONE: InboxValue = { count: 0, dragging: false, refused: [], clearRefused() {}, choose: async () => {} };
const Ctx = createContext<InboxValue>(NONE);
export const useInbox = () => useContext(Ctx);

const BATCH = 50;
const pathOf = (file: File): string => {
  const bridge = (window as unknown as { rlBridge?: { pathForFile?(f: File): string } }).rlBridge;
  try {
    return bridge?.pathForFile?.(file) ?? '';
  } catch {
    return '';
  }
};
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * What the first screen needs of the inbox, kept tiny: the count for the badge, the drop hint and the drop itself (PDFs
 * dropped anywhere on the window go to `inbox:add`, and the window moves to the Inbox section). The inbox view itself
 * loads when it is opened.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { activeLibraryId } = useApp();
  const { openInbox } = useAiUi();
  const { invalidate } = useLibraryEvents();
  const { fail, reportError } = useNotify();
  const [count, setCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refused, setRefused] = useState<InboxRefusal[]>([]);
  const depth = useRef(0);
  const lib = useRef(activeLibraryId);
  lib.current = activeLibraryId;

  useEffect(() => {
    setCount(0);
    setRefused([]);
    if (!activeLibraryId) return;
    let live = true;
    // Only the count, from the local queue: no document is read and nothing is looked up online until the Inbox opens.
    const count = (recount: boolean) =>
      rl.invoke('inbox:count', { recount }).then(
        (r) => live && setCount(r.count),
        () => {},
      );
    void count(false);
    const off = rl.on('inbox:changed', (e) => setCount(e.count));
    // Files a scan flagged count too: recount (a local pass over the records) when a scan has finished.
    const offScan = rl.on('scan:progress', (s) => {
      if (s.libraryId === activeLibraryId && s.state === 'done') void count(true);
    });
    return () => {
      live = false;
      off();
      offScan();
    };
  }, [activeLibraryId]);

  const finish = useCallback(
    (results: AddResult[]) => {
      setRefused(results.flatMap((r) => r.refused));
      if (results.some((r) => r.added.length > 0)) invalidate('documents');
      openInbox();
    },
    [invalidate, openInbox],
  );

  const choose = useCallback(async () => {
    if (!lib.current) return fail(t('inbox.needsLibrary'));
    try {
      const r = await rl.invoke('inbox:choose', {});
      if (r.added.length > 0 || r.refused.length > 0) finish([r]);
    } catch (e) {
      reportError(e);
    }
  }, [fail, finish, reportError, t]);

  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // the window must never navigate to the dropped file
      depth.current = 0;
      setDragging(false);
      if (!lib.current) return fail(t('inbox.needsLibrary'));
      const paths = Array.from(e.dataTransfer?.files ?? [])
        .map(pathOf)
        .filter((p) => p !== '');
      // Dropped from somewhere that is not a file on this computer (a browser, another app's window): say so.
      if (paths.length === 0) {
        if ((e.dataTransfer?.files.length ?? 0) > 0) fail(t('inbox.noPath'));
        return;
      }
      void (async () => {
        try {
          const results: AddResult[] = [];
          for (let i = 0; i < paths.length; i += BATCH) results.push(await rl.invoke('inbox:add', { paths: paths.slice(i, i + BATCH) }));
          finish(results);
        } catch (err) {
          reportError(err);
        }
      })();
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [fail, finish, reportError, t]);

  const value = useMemo(() => ({ count, dragging, refused, clearRefused: () => setRefused([]), choose }), [count, dragging, refused, choose]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
