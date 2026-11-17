import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocalFlag } from './useLocalFlag';

/**
 * What the AI interface shares with the rest of the window, kept tiny because it is part of the first screen: whether
 * the chat panel and the command palette are open, the document selection and the reader position the chat uses as
 * context, a prompt the palette filled, and requests to move to Settings or a project. The chat itself (and everything
 * AI) loads only when the panel is first opened.
 *
 * Keys: Ctrl+J shows or hides the chat panel, Ctrl+K opens the command palette (Cmd on macOS).
 */
export interface ReaderContext {
  docId: string;
  page: number;
}
export interface Navigation {
  to: 'settings' | 'project' | 'inbox' | 'review';
  projectId?: string;
  nonce: number;
}

interface AiUiValue {
  chatOpen: boolean;
  setChatOpen(open: boolean): void;
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  /** Documents selected in the library list. */
  selection: readonly string[];
  publishSelection(ids: readonly string[]): void;
  /** The document and page open in the reader, or null. */
  reader: ReaderContext | null;
  publishReader(ctx: ReaderContext | null): void;
  /** Text the palette chose for the prompt (never sent by the palette); `nonce` changes at every request. */
  prefill: { text: string; nonce: number } | null;
  fillPrompt(text: string): void;
  navigation: Navigation | null;
  openProject(id: string): void;
  openSettings(): void;
  /** The Inbox section, on the arrivals tab or on the AI proposals (review). */
  openInbox(): void;
  openReview(): void;
}

const NONE: AiUiValue = {
  chatOpen: false,
  setChatOpen() {},
  paletteOpen: false,
  setPaletteOpen() {},
  selection: [],
  publishSelection() {},
  reader: null,
  publishReader() {},
  prefill: null,
  fillPrompt() {},
  navigation: null,
  openProject() {},
  openSettings() {},
  openInbox() {},
  openReview() {},
};
const Ctx = createContext<AiUiValue>(NONE);
export const useAiUi = (): AiUiValue => useContext(Ctx);

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function AiUiProvider({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useLocalFlag('rl.chatOpen', false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [reader, setReader] = useState<ReaderContext | null>(null);
  const [prefill, setPrefill] = useState<AiUiValue['prefill']>(null);
  const [navigation, setNavigation] = useState<Navigation | null>(null);

  const publishSelection = useCallback((ids: readonly string[]) => setSelection((cur) => (sameIds(cur, ids) ? cur : ids)), []);
  const publishReader = useCallback((ctx: ReaderContext | null) => setReader((cur) => (cur?.docId === ctx?.docId && cur?.page === ctx?.page ? cur : ctx)), []);
  const fillPrompt = useCallback((text: string) => setPrefill((cur) => ({ text, nonce: (cur?.nonce ?? 0) + 1 })), []);
  const openProject = useCallback((id: string) => setNavigation((cur) => ({ to: 'project', projectId: id, nonce: (cur?.nonce ?? 0) + 1 })), []);
  const openSettings = useCallback(() => setNavigation((cur) => ({ to: 'settings', nonce: (cur?.nonce ?? 0) + 1 })), []);

  const openInbox = useCallback(() => setNavigation((cur) => ({ to: 'inbox', nonce: (cur?.nonce ?? 0) + 1 })), []);
  const openReview = useCallback(() => setNavigation((cur) => ({ to: 'review', nonce: (cur?.nonce ?? 0) + 1 })), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'j') {
        e.preventDefault();
        setChatOpen(!chatOpen);
      } else if (k === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen, setChatOpen]);

  const value = useMemo(
    () => ({ chatOpen, setChatOpen, paletteOpen, setPaletteOpen, selection, publishSelection, reader, publishReader, prefill, fillPrompt, navigation, openProject, openSettings, openInbox, openReview }),
    [chatOpen, setChatOpen, paletteOpen, selection, publishSelection, reader, publishReader, prefill, fillPrompt, navigation, openProject, openSettings, openInbox, openReview],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
