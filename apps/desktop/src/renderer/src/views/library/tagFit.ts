/** Rough width of a tag chip in a card, in pixels: 6.2 per character plus the padding and border. */
const chipWidth = (label: string): number => Math.round(label.length * 6.2) + 18;
const GAP = 4;
/** Room the "+N" chip needs. */
const MORE = 36;

/**
 * How many of the tags fit on the one line of a grid card without a chip cut in half: as many as fit in `width` pixels, leaving room for
 * "+N" when some are left out; at least one (a chip too wide for the line is cut with an ellipsis by the stylesheet) (D-508).
 */
export function fitTags(labels: readonly string[], width: number): number {
  if (labels.length === 0) return 0;
  const total = labels.reduce((s, l) => s + chipWidth(l) + GAP, -GAP);
  if (total <= width) return labels.length;
  let used = 0;
  let n = 0;
  for (const l of labels) {
    const next = used + (n > 0 ? GAP : 0) + chipWidth(l);
    if (next + GAP + MORE > width) break;
    used = next;
    n++;
  }
  return Math.max(1, n);
}
