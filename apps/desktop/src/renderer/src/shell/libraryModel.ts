/** The tint of a library in the switcher: one of the 8 `--lib-N` colours, from the name (the same name always gets the same one). */
export const libraryTint = (name: string): number => 1 + ([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 8);
/** A folder path shortened in the middle for the switcher list: the last two segments. */
export const shortPath = (p: string): string => {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join('/')}`;
};
