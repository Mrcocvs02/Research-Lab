import { useCallback, useEffect, useReducer, useState } from 'react';
import type { TFunction } from 'i18next';
import { rl } from '../../lib/rl';
import { OTHER_CLUSTER_ID, mainArea, type AreaDef, type AreaTriples } from './areaColors';
import type { PreparedMap } from './mapModel';

/**
 * "Group by" of the Map (D-489, section 18.3.7): the family the nodes are coloured and pulled together by. `topic` is the macro-areas
 * used today; every other family comes from `graph:family` (a tag kind, research groups, or communities found in the network).
 */
export const TOPIC_FAMILY = 'topic';
/** The family the Map opens with when the viewer has not chosen one and no field vocabulary is active: the communities found in the network (user choice, D-510). */
export const DEFAULT_FAMILY = 'auto';
/** "None": the free layout of the map, with no blocks (D-498). */
export const NONE_FAMILY = 'none';
const KEY = 'rl.map.family';
const EVENT = 'rl-map-family';
const NAMES_EVENT = 'rl-map-family-names';

export interface FamilyInfo {
  id: string;
  label: string;
  count: number;
  /** Whether the family passes the test of the blocks, and the numbers behind it (section 19.2.2). */
  eligible?: boolean | undefined;
  reason?: { coverage: number; clarity: number; values: number } | undefined;
  /** The macro-areas are the ones of a field vocabulary (D-569, D-570): the share of clear papers is not the measure. */
  pack?: boolean | undefined;
}

/** The family the Map opens with when the viewer never chose one (D-574): Topic with a field vocabulary and Topic eligible, else Automatic (D-510). */
export const defaultFamily = (list: readonly FamilyInfo[]): string => {
  const topic = list.find((f) => f.id === TOPIC_FAMILY);
  return topic?.pack && topic.eligible ? TOPIC_FAMILY : DEFAULT_FAMILY;
};
/** Share of the papers that sit in a clear value of a family, in percent (section 19.2.2): coverage x clarity, the papers a block shows with certainty. */
export const clearShare = (f: Pick<FamilyInfo, 'reason'>): number => (f.reason ? Math.round(100 * f.reason.coverage * f.reason.clarity) : 0);

/**
 * The families the menu offers: every one that has values stays choosable, whether or not it passes the test (a partial one says so in the strip);
 * one that groups no paper clearly (0 %) is left out, and the chosen one is always there (D-499).
 */
export function offerFamilies(list: readonly FamilyInfo[], current: string): FamilyInfo[] {
  return list.filter((f) => f.id === current || f.id === 'auto' || f.eligible !== false || clearShare(f) > 0);
}

/**
 * Which pill the macro-areas offer (D-520, D-574): without a field vocabulary, "groups N % of the papers clearly" below 70 %; with one the percentage is
 * not the measure (D-569, D-570), so the pill is neutral and shows only when the proposal has moves (`packMoves`, null while unknown).
 */
export function macroPillKind(info: FamilyInfo | undefined, packMoves: number | null): 'clarity' | 'pack' | null {
  if (!info?.reason || info.reason.values < 2) return null;
  if (info.pack) return packMoves !== null && packMoves > 0 ? 'pack' : null;
  return clearShare(info) < 70 ? 'clarity' : null;
}

/** Whether the family is on but groups clearly only part of the papers (the strip says so). */
export const isPartial = (f: FamilyInfo | undefined): f is FamilyInfo => !!f && f.eligible === false && f.id !== 'none';

export interface FamilyShares {
  areas: AreaDef[];
  items: Array<{ id: string; ar?: AreaTriples | undefined; az?: number | undefined }>;
}

/** What the library says its default is (set by `useFamilies`); `null` until the families are known. Never written to storage: only an explicit choice is. */
let known: string | null = null;

function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}
const readFamily = (): string => readStored() ?? known ?? DEFAULT_FAMILY;

/**
 * The chosen family, shared by the Panorama and the network (a per-viewer convenience, kept in localStorage when it works). The third value
 * says whether it is settled: an explicit choice is, the default waits for the families of the library (so the Map does not compute Automatic first).
 */
export function useFamily(): [string, (id: string) => void, boolean] {
  const [family, setFamily] = useState(readFamily);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const on = () => {
      setFamily(readFamily());
      refresh();
    };
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
  return [family, set, readStored() !== null || known !== null];
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
      (r) => {
        if (!live) return;
        setList(r.families);
        const d = defaultFamily(r.families);
        if (known !== d) {
          known = d;
          window.dispatchEvent(new Event(EVENT));
        }
      },
      () => {
        if (live && known === null) {
          known = DEFAULT_FAMILY;
          window.dispatchEvent(new Event(EVENT));
        }
      },
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
  const out = { ...map, areas: fam.areas, ar, az, withArea };
  return nameByFamily(out);
}

/**
 * One naming source while a family is on (D-491): each cluster of the map is called after the area of the family that holds most of its
 * points, so the canvas labels and the legend say the same thing. Clusters whose points have no area keep their own terms.
 */
export function nameByFamily(map: PreparedMap): PreparedMap {
  const levels = map.levels.map((list, L) => {
    const g = map.groups[L];
    if (!g) return list;
    return list.map((c, s) => {
      const count = new Map<number, number>();
      for (let j = g.starts[s]!; j < g.starts[s + 1]!; j++) {
        const a = mainArea(map.ar[g.order[j]!]);
        if (a >= 0) count.set(a, (count.get(a) ?? 0) + 1);
      }
      let best = -1;
      let q = 0;
      for (const [a, n] of count) if (n > q || (n === q && a < best)) [best, q] = [a, n];
      const label = best >= 0 ? map.areas[best]?.label : undefined;
      return label ? { ...c, famLabel: label } : c;
    });
  });
  return { ...map, levels, clusterById: new Map(levels.flat().map((c) => [c.id, c])) };
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
