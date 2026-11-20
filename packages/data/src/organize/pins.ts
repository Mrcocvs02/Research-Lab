import type { DocumentRecord } from '@rl/core';

/** The hand-fixed main values of a paper (`mainTags`, D-521): family key -> a tag the paper carries. */
export type Pins = Record<string, string>;

/** The fixed main values that still hold (the paper must carry the tag), after `resolve` (merges); `undefined` when none is left. */
export const livePins = (pins: Pins | undefined, tags: readonly string[], resolve?: (t: string) => string): Pins | undefined => {
  const kept = Object.entries(pins ?? {})
    .map(([k, t]): [string, string] => [k, resolve ? resolve(t) : t])
    .filter(([, t]) => tags.includes(t));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
};

/** `rec` with its `mainTags` set to `pins` (removed when none). */
export const withPins = (rec: DocumentRecord, pins: Pins | undefined): DocumentRecord => {
  const { mainTags: _old, ...rest } = rec;
  return pins ? { ...rest, mainTags: pins } : rest;
};
