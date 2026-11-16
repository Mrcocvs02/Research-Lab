import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { rl } from './rl';

export type ChangeKind = 'documents' | 'taxonomy' | 'projects' | 'notes' | 'annotations';
type Versions = Record<ChangeKind, number>;

interface EventsValue {
  versions: Versions;
  /** Marks a kind as changed (used after our own writes, and by the "reload" action of a conflict notice). */
  invalidate(kind: ChangeKind): void;
  invalidateAll(): void;
}

const NONE: EventsValue = { versions: { documents: 0, taxonomy: 0, projects: 0, notes: 0, annotations: 0 }, invalidate() {}, invalidateAll() {} };
const Ctx = createContext<EventsValue>(NONE);

/**
 * Turns the `library:changed` event into per-kind counters. A view puts the counter in the dependencies of its
 * loading effect and reloads when it moves; nothing else is needed to stay current (checklist item 10).
 */
export function LibraryEventsProvider({ children }: { children: ReactNode }) {
  const [versions, setVersions] = useState<Versions>({ documents: 0, taxonomy: 0, projects: 0, notes: 0, annotations: 0 });
  const invalidate = useCallback((kind: ChangeKind) => setVersions((v) => ({ ...v, [kind]: v[kind] + 1 })), []);
  const invalidateAll = useCallback(() => setVersions((v) => ({ documents: v.documents + 1, taxonomy: v.taxonomy + 1, projects: v.projects + 1, notes: v.notes + 1, annotations: v.annotations + 1 })), []);
  useEffect(() => rl.on('library:changed', (e) => invalidate(e.kind)), [invalidate]);
  const value = useMemo(() => ({ versions, invalidate, invalidateAll }), [versions, invalidate, invalidateAll]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLibraryEvents = () => useContext(Ctx);

/** The counter of one kind of change: reload when it moves. */
export const useChangeVersion = (kind: ChangeKind): number => useContext(Ctx).versions[kind];
