import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** Where the reader should open: a page, and optionally the side panel tab to show. */
export interface ReaderTarget {
  docId: string;
  page?: number;
  panel?: ReaderPanel;
  /** Changes at every request, so that asking for the same page again scrolls there again. */
  nonce: number;
}
export type ReaderPanel = 'annotations' | 'pageNote' | 'fileNote' | 'notes';

interface ReaderValue {
  target: ReaderTarget | null;
  /** Opens the in-app reader on a document (a PDF), optionally at a page. Any view can call it; phase 4 links use it too. */
  openReader(docId: string, page?: number, opts?: { panel?: ReaderPanel }): void;
  closeReader(): void;
}

const NONE: ReaderValue = { target: null, openReader() {}, closeReader() {} };
const Ctx = createContext<ReaderValue>(NONE);

/** Holds what the reader shows. Only a few bytes of state: the reader itself (and pdf.js) loads when `target` is set. */
export function ReaderProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ReaderTarget | null>(null);
  const openReader = useCallback<ReaderValue['openReader']>((docId, page, opts) => {
    setTarget((cur) => ({ docId, ...(page !== undefined ? { page } : {}), ...(opts?.panel ? { panel: opts.panel } : {}), nonce: (cur?.nonce ?? 0) + 1 }));
  }, []);
  const closeReader = useCallback(() => setTarget(null), []);
  const value = useMemo(() => ({ target, openReader, closeReader }), [target, openReader, closeReader]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useReader = (): ReaderValue => useContext(Ctx);

/** A document the in-app reader can open: a PDF file that is present. */
export const canRead = (path: string, missing: boolean): boolean => !missing && /\.pdf$/i.test(path);
