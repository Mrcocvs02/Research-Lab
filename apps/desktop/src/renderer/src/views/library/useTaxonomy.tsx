import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Channels, RequestOf, ResponseOf, TaxonomyOp, TaxonomyView } from '@rl/core';
import { useChangeVersion, useLibraryEvents } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { buildModel, type TaxonomyModel } from './taxonomyModel';

export type ApplyResult = ResponseOf<Channels, 'taxonomy:apply'>;
type ApplyRequest = RequestOf<Channels, 'taxonomy:apply'>;

interface TaxonomyValue {
  view: TaxonomyView | null;
  model: TaxonomyModel;
  loaded: boolean;
  error: unknown;
  reload(): Promise<void>;
  /** Applies operations as one undoable change. Returns null when it failed (the failure is already shown). */
  apply(ops: TaxonomyOp[]): Promise<ApplyResult | null>;
  labelOf(id: string): string;
  colorOf(id: string): string | undefined;
}

const EMPTY_MODEL = buildModel([]);
const DEFAULT: TaxonomyValue = {
  view: null,
  model: EMPTY_MODEL,
  loaded: false,
  error: null,
  reload: async () => {},
  apply: async () => null,
  labelOf: (id) => id,
  colorOf: () => undefined,
};
const Ctx = createContext<TaxonomyValue>(DEFAULT);
export const useTaxonomy = () => useContext(Ctx);

/** The taxonomy of the active library, kept current on `library:changed` (taxonomy). */
export function TaxonomyProvider({ children }: { children: ReactNode }) {
  // The counts per node follow the documents too, so both kinds of change reload it.
  const version = useChangeVersion('taxonomy') + useChangeVersion('documents');
  const { invalidate } = useLibraryEvents();
  const { reportError } = useNotify();
  const [view, setView] = useState<TaxonomyView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ticket = useRef(0);
  const viewRef = useRef<TaxonomyView | null>(null);
  viewRef.current = view;

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const v = await rl.invoke('taxonomy:get', {});
      if (mine === ticket.current) {
        setView(v);
        setError(null);
      }
    } catch (e) {
      if (mine === ticket.current) setError(e);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, version]);

  const apply = useCallback(
    async (ops: TaxonomyOp[]) => {
      const request: ApplyRequest = { ops };
      if (viewRef.current) request.expectedRevision = viewRef.current.revision;
      try {
        const result = await rl.invoke('taxonomy:apply', request);
        setView(result.taxonomy);
        invalidate('taxonomy');
        if (result.documentsChanged > 0) invalidate('documents');
        return result;
      } catch (e) {
        reportError(e);
        return null;
      }
    },
    [invalidate, reportError],
  );

  const model = useMemo(() => (view ? buildModel(view.nodes) : EMPTY_MODEL), [view]);
  const value = useMemo<TaxonomyValue>(
    () => ({
      view,
      model,
      loaded: view !== null,
      error,
      reload,
      apply,
      labelOf: (id) => model.byId.get(id)?.label ?? id,
      colorOf: (id) => model.byId.get(id)?.color,
    }),
    [view, model, error, reload, apply],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
