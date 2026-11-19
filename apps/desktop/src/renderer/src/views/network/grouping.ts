import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { rl } from '../../lib/rl';
import { OTHER_CLUSTER_ID, type AreaDef, type AreaTriples } from './areaColors';
import type { PreparedMap } from './mapModel';

/**
 * "Group by" of the Map (D-489, section 18.3.7): the family the nodes are coloured and pulled together by. `topic` is the macro-areas
 * used today; every other family comes from `graph:family` (a tag kind, research groups, or communities found in the network).
 */
export const TOPIC_FAMILY = 'topic';
const KEY = 'rl.map.family';
const EVENT = 'rl-map-family';
const NAMES_EVENT = 'rl-map-family-names';

export interface FamilyInfo {
  id: string;
  label: string;
  count: number;
}
export interface FamilyShares {
  areas: AreaDef[];
  items: Array<{ id: string; ar?: AreaTriples | undefined; az?: number | undefined }>;
}

function readFamily(): string {
  try {
    return window.localStorage.getItem(KEY) || TOPIC_FAMILY;
  } catch {
    return TOPIC_FAMILY;
  }
}

/** The chosen family, shared by the Panorama and the network (a per-viewer convenience, kept in localStorage when it works). */
export function useFamily(): [string, (id: string) => void] {
  const [family, setFamily] = useState(readFamily);
  useEffect(() => {
    const on = () => setFamily(readFamily());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  const set = useCallback((id: string) => {
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* storage unavailable: the choice lives until the next load */
    }
    setFamily(id);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [family, set];
}

/** Tells the views that the names of the automatic clusters changed (they ask `graph:family` again). */
export const bumpFamilyNames = (): void => {
  window.dispatchEvent(new Event(NAMES_EVENT));
};

/** A counter that grows each time `bumpFamilyNames` is called. */
export function useFamilyRev(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const on = () => setRev((r) => r + 1);
    window.addEventListener(NAMES_EVENT, on);
    return () => window.removeEventListener(NAMES_EVENT, on);
  }, []);
  return rev;
}

/** The families the library offers (always at least the topic), for the chooser. */
export function useFamilies(scope?: Record<string, string> | undefined, enabled = true): FamilyInfo[] {
  const [list, setList] = useState<FamilyInfo[]>([{ id: TOPIC_FAMILY, label: 'Topic', count: 0 }]);
  const key = JSON.stringify(scope ?? null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    rl.invoke('graph:family', scope ? { scope } : {}).then(
      (r) => live && setList(r.families),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return list;
}

/** Label of a family: the known ones are translated, the others keep the name the main process gave. */
export function familyLabel(t: TFunction, f: { id: string; label: string }): string {
  const known: Record<string, string> = { topic: 'topic', auto: 'auto', 'level:method': 'method', 'prefix:grp:': 'group' };
  const k = known[f.id];
  return k ? t(`network.group.${k}`) : f.label;
}

/** Name of the chosen family for the label and the legend title. */
export const familyName = (t: TFunction, list: readonly FamilyInfo[], id: string): string => familyLabel(t, list.find((f) => f.id === id) ?? { id, label: id });

/** The clusters with the "other" one named in the language of the interface. */
export const nameClusters = (t: TFunction, defs: readonly AreaDef[]): AreaDef[] => defs.map((d) => (d.id === OTHER_CLUSTER_ID ? { ...d, label: t('network.group.other') } : d));

/** The Panorama with the shares of a family in place of the macro-area ones (the map itself is not touched). */
export function withFamilyShares(map: PreparedMap, fam: FamilyShares): PreparedMap {
  const ar = new Array<AreaTriples | undefined>(map.n);
  const az = new Uint8Array(map.n);
  let withArea = 0;
  for (const it of fam.items) {
    const i = map.indexOf.get(it.id);
    if (i === undefined || !it.ar || it.ar.length === 0) continue;
    ar[i] = it.ar;
    az[i] = it.az ?? 0;
    withArea++;
  }
  return { ...map, areas: fam.areas, ar, az, withArea };
}

/** Sets the shares of document nodes from `graph:family` items; documents without an item lose theirs (they go to the "none" block). */
export function applyShares(nodes: Iterable<{ kind: string; id: string; ar?: AreaTriples | undefined; az?: number | undefined }>, items: FamilyShares['items']): void {
  const by = new Map(items.map((i) => [i.id, i]));
  for (const n of nodes) {
    if (n.kind !== 'doc') continue;
    const it = by.get(n.id);
    n.ar = it?.ar && it.ar.length > 0 ? it.ar : undefined;
    n.az = it?.az;
  }
}
