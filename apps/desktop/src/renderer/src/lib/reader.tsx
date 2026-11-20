import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { flushAll } from './dirtyEditors';
import { useNotify } from './notify';

/** Where the reader should open: a page, and optionally the side panel tab to show. */
export interface ReaderTarget {
  docId: string;
  page?: number;
  panel?: ReaderPanel;
  /** A second paper read side by side with `docId` (feature 3); when set, the reader is the split one. */
  beside?: string;
  /** Changes at every request, so that asking for the same page again scrolls there again. */
  nonce: number;
}
/** Settings › Advanced › "Experimental features": a per-viewer flag (the experiments, like the guide, exist only while it is on). */
export const EXPERIMENTAL_KEY = 'rl.experimental';
export type ReaderPanel = 'annotations' | 'pageNote' | 'fileNote' | 'notes' | 'literature';

interface ReaderValue {
  target: ReaderTarget | null;
  /** Opens the in-app reader on a document (a PDF), optionally at a page. Any view can call it; phase 4 links use it too. */
  openReader(docId: string, page?: number, opts?: { panel?: ReaderPanel; beside?: string }): void;
  /**
   * Closes the reader after every unsaved note has been saved; if one cannot be saved the reader stays open (the editor
   * shows the error) and nothing typed is lost.
   */
  closeReader(): void;
  /** Closes at once, without saving: only for when the library the reader belongs to is already gone. */
  dropReader(): void;
}

const NONE: ReaderValue = { target: null, openReader() {}, closeReader() {}, dropReader() {} };
const Ctx = createContext<ReaderValue>(NONE);

/** Holds what the reader shows. Only a few bytes of state: the reader itself (and pdf.js) loads when `target` is set. */
export function ReaderProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ReaderTarget | null>(null);
  const openReader = useCallback<ReaderValue['openReader']>((docId, page, opts) => {
    setTarget((cur) => ({ docId, ...(page !== undefined ? { page } : {}), ...(opts?.panel ? { panel: opts.panel } : {}), ...(opts?.beside && opts.beside !== docId ? { beside: opts.beside } : {}), nonce: (cur?.nonce ?? 0) + 1 }));
  }, []);
  const { t } = useTranslation();
  const { fail } = useNotify();
  const dropReader = useCallback(() => setTarget(null), []);
  const closeReader = useCallback(() => {
    flushAll().then(
      () => setTarget(null),
      () => fail(t('notes.flushFailed')),
    );
  }, [fail, t]);
  const value = useMemo(() => ({ target, openReader, closeReader, dropReader }), [target, openReader, closeReader, dropReader]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useReader = (): ReaderValue => useContext(Ctx);

/** A document the in-app reader can open: a PDF file that is present. */
export const canRead = (path: string, missing: boolean): boolean => !missing && /\.pdf$/i.test(path);
