/**
 * What another view asks of the Map when it opens it (section 20.2.3): the macro-areas dialog (palette) or a set of papers to select
 * ("Select the unclear ones" from the dialog of the guided cleanup). A one-slot mailbox read by the Map when it mounts (the same pattern
 * as `mapStartIntent`); `MAP_INTENT_EVENT` reaches a Map that is on screen already.
 */
export interface MapIntent {
  /** Open the macro-areas dialog for Topic. */
  macro?: boolean;
  /** Papers to select (at most 5000). */
  select?: string[];
  /** Open "Move to..." for these papers (the panel of a paper). */
  move?: string[];
}

export const MAP_INTENT_EVENT = 'rl:map-intent';

let pending: MapIntent | null = null;

/** Leaves a request and tells a Map that is already mounted. */
export function setMapIntent(intent: MapIntent | null): void {
  pending = intent;
  if (intent) window.dispatchEvent(new Event(MAP_INTENT_EVENT));
}

export function takeMapIntent(): MapIntent | null {
  const p = pending;
  pending = null;
  return p;
}
