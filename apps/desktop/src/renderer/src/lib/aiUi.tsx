import { openTagManager } from './libraryIntent';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useShortcut } from './keymap';
import { useLocalFlag } from './useLocalFlag';

/**
 * What the AI interface shares with the rest of the window, kept tiny because it is part of the first screen: whether
 * the chat panel and the command palette are open, the document selection and the reader position the chat uses as
 * context, a prompt the palette filled, and requests to move to Settings or a project. The chat itself (and everything
 * AI) loads only when the panel is first opened.
 *
 * Keys (the user's accelerators from the keymap, `lib/keymap.tsx`): Ctrl+J shows or hides the chat panel, Ctrl+K opens
 * the command palette, Alt+1..5 and Ctrl+, move between the views, Ctrl+L focuses the search, F1 opens the guide and
 * Ctrl+/ the list of shortcuts (Cmd on macOS).
 */
export interface ReaderContext {
  docId: string;
  page: number;
}
/** An advanced search the dialog asks the chat panel to run (a new conversation, streamed in the panel). */
/** Same values as `ReasoningLevel` of the contracts (not imported: this file is part of the first screen). */
type Reasoning = 'low' | 'medium' | 'high';
export interface SearchRequest {
  text: string;
  model: string;
  reasoning: Reasoning;
  nonce: number;
}
export interface Navigation {
  /** `inbox` (new files) and `network` are the old names of `review` (files tab) and `map`, still accepted. */
  to: 'settings' | 'project' | 'inbox' | 'review' | 'library' | 'projects' | 'network' | 'map' | 'discover' | 'newLibrary';
  /** `review`: the tab to show; without it the window picks the one that has something to decide. */
  tab?: 'files' | 'proposals';
  projectId?: string;
  /** Where to put the focus once the view is shown (`search`: the library search box; `backup`: the backup section of the settings). */
  focus?: string;
  /** Something to start once the view is shown (`backupNow`: the backup section starts a backup, once per nonce). */
  run?: 'backupNow';
  nonce: number;
}
/** What the in-app guide dialog shows: the usage guide or only the list of shortcuts. */
export type GuideKind = 'guide' | 'shortcuts';

/** What the second-brain export dialog starts from (any mix; the dialog lets the user change it). */
export interface ExportInit {
  projectId?: string;
  folders?: string[];
  tagIds?: string[];
  /** Clusters of the graph model, with the text shown for them. */
  clusters?: Array<{ id: string; label: string }>;
  docIds?: string[];
  /** Name to start the folder name from. */
  name?: string;
}

interface AiUiValue {
  chatOpen: boolean;
  setChatOpen(open: boolean): void;
  paletteOpen: boolean;
  setPaletteOpen(open: boolean): void;
  /** Documents selected in the library list. */
  selection: readonly string[];
  publishSelection(ids: readonly string[]): void;
  /** An answer of the chat is being written (only one at a time): the advanced search cannot start meanwhile. */
  chatBusy: boolean;
  setChatBusy(busy: boolean): void;
  /** The document and page open in the reader, or null. */
  reader: ReaderContext | null;
  publishReader(ctx: ReaderContext | null): void;
  /** Text the palette chose for the prompt (never sent by the palette); `nonce` changes at every request. */
  prefill: { text: string; nonce: number } | null;
  fillPrompt(text: string): void;
  /** Opens the chat panel and asks it to run an advanced search; the panel takes the request (`takeSearch`) once. */
  searchRequest: SearchRequest | null;
  startSearch(req: Omit<SearchRequest, 'nonce'>): void;
  takeSearch(nonce: number): void;
  navigation: Navigation | null;
  openProject(id: string): void;
  openSettings(): void;
  /** The Inbox section, on the arrivals tab or on the AI proposals (review). */
  openInbox(): void;
  openReview(): void;
  /** Any view, optionally with a focus target or an action to start (palette, shortcuts). */
  goTo(to: Navigation['to'], extra?: Pick<Navigation, 'focus' | 'run' | 'tab'>): void;
  /** The Activity popover of the top bar (scan, AI jobs, citations...), opened by its chip, the palette or a toast. */
  activityOpen: boolean;
  setActivityOpen(open: boolean): void;
  /** The in-app guide (F1) or the list of shortcuts (Ctrl+/), a lazy dialog in the Shell; null when closed. */
  guide: GuideKind | null;
  openGuide(kind?: GuideKind): void;
  closeGuide(): void;
  /** The second-brain export dialog (lazy, in the Shell): `exportInit` is what it starts from, null when closed. */
  exportInit: ExportInit | null;
  openExport(init?: ExportInit): void;
  closeExport(): void;
}

const NONE: AiUiValue = {
  chatOpen: false,
  setChatOpen() {},
  paletteOpen: false,
  setPaletteOpen() {},
  selection: [],
  publishSelection() {},
  chatBusy: false,
  setChatBusy() {},
  reader: null,
  publishReader() {},
  prefill: null,
  fillPrompt() {},
  searchRequest: null,
  startSearch() {},
  takeSearch() {},
  navigation: null,
  openProject() {},
  openSettings() {},
  openInbox() {},
  openReview() {},
  goTo() {},
  activityOpen: false,
  setActivityOpen() {},
  guide: null,
  openGuide() {},
  closeGuide() {},
  exportInit: null,
  openExport() {},
  closeExport() {},
};
const Ctx = createContext<AiUiValue>(NONE);
export const useAiUi = (): AiUiValue => useContext(Ctx);

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function AiUiProvider({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useLocalFlag('rl.chatOpen', false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [reader, setReader] = useState<ReaderContext | null>(null);
  const [prefill, setPrefill] = useState<AiUiValue['prefill']>(null);
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const [navigation, setNavigation] = useState<Navigation | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [guide, setGuide] = useState<GuideKind | null>(null);
  const openGuide = useCallback((kind: GuideKind = 'guide') => setGuide(kind), []);
  const closeGuide = useCallback(() => setGuide(null), []);
  const [exportInit, setExportInit] = useState<ExportInit | null>(null);
  const openExport = useCallback((init: ExportInit = {}) => setExportInit(init), []);
  const closeExport = useCallback(() => setExportInit(null), []);

  const publishSelection = useCallback((ids: readonly string[]) => setSelection((cur) => (sameIds(cur, ids) ? cur : ids)), []);
  const publishReader = useCallback((ctx: ReaderContext | null) => setReader((cur) => (cur?.docId === ctx?.docId && cur?.page === ctx?.page ? cur : ctx)), []);
  const fillPrompt = useCallback((text: string) => setPrefill((cur) => ({ text, nonce: (cur?.nonce ?? 0) + 1 })), []);
  const startSearch = useCallback(
    (req: Omit<SearchRequest, 'nonce'>) => {
      setSearchRequest((cur) => ({ ...req, nonce: (cur?.nonce ?? 0) + 1 }));
      setChatOpen(true);
    },
    [setChatOpen],
  );
  const takeSearch = useCallback((nonce: number) => setSearchRequest((cur) => (cur?.nonce === nonce ? null : cur)), []);
  const openProject = useCallback((id: string) => setNavigation((cur) => ({ to: 'project', projectId: id, nonce: (cur?.nonce ?? 0) + 1 })), []);
  const openSettings = useCallback(() => setNavigation((cur) => ({ to: 'settings', nonce: (cur?.nonce ?? 0) + 1 })), []);

  const openInbox = useCallback(() => setNavigation((cur) => ({ to: 'inbox', nonce: (cur?.nonce ?? 0) + 1 })), []);
  const openReview = useCallback(() => setNavigation((cur) => ({ to: 'review', tab: 'proposals', nonce: (cur?.nonce ?? 0) + 1 })), []);

  const goTo = useCallback<AiUiValue['goTo']>((to, extra = {}) => setNavigation((cur) => ({ to, ...extra, nonce: (cur?.nonce ?? 0) + 1 })), []);

  useShortcut('chat.toggle', () => setChatOpen(!chatOpen));
  useShortcut('palette.open', () => setPaletteOpen(true));
  useShortcut('search.focus', () => goTo('library', { focus: 'search' }));
  useShortcut('nav.library', () => goTo('library'));
  useShortcut('nav.projects', () => goTo('projects'));
  useShortcut('nav.map', () => goTo('map'));
  useShortcut('nav.discover', () => goTo('discover'));
  useShortcut('nav.review', () => goTo('review'));
  useShortcut('nav.settings', () => goTo('settings'));
  useShortcut('tags.manage', () => openTagManager(() => goTo('library')));
  useShortcut('guide.open', () => openGuide('guide'), { inModal: true });
  useShortcut('shortcuts.show', () => openGuide('shortcuts'), { inModal: true });

  const value = useMemo(
    () => ({ chatOpen, setChatOpen, paletteOpen, setPaletteOpen, selection, publishSelection, chatBusy, setChatBusy, reader, publishReader, prefill, fillPrompt, searchRequest, startSearch, takeSearch, navigation, openProject, openSettings, openInbox, openReview, goTo, activityOpen, setActivityOpen, guide, openGuide, closeGuide, exportInit, openExport, closeExport }),
    [chatOpen, setChatOpen, paletteOpen, selection, publishSelection, chatBusy, reader, publishReader, prefill, fillPrompt, searchRequest, startSearch, takeSearch, navigation, openProject, openSettings, openInbox, openReview, goTo, activityOpen, setActivityOpen, guide, openGuide, closeGuide, exportInit, openExport, closeExport],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
