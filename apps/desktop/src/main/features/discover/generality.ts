/**
 * Down-ranking of "trivial" candidates (D-492): old, foundational, very highly cited works that everybody in the field
 * cites. Citation counts are normalised by age (citations per year) and by how widely the seeds cite the work; a work
 * that is both ancient and enormously cited is a "classic" and is hidden unless the user asks for classics.
 */
export interface WorkStats {
  year: number | null;
  cited: number;
}

/** A work at least this old (years) with at least this many citations is a classic. */
export const CLASSIC_MIN_AGE = 15;
export const CLASSIC_MIN_CITED = 2000;
/** Citations per year above which a work is treated as field-wide whatever its age. */
const POPULAR_PER_YEAR = 20;

export const ageOf = (year: number | null, now: Date): number => (year === null ? 5 : Math.max(1, now.getUTCFullYear() - year + 1));

/** Multiplier in (0, 1]: 1 for a recent or specific work, down to about 0.25 for a field-wide one. */
export function specificity(w: WorkStats, now: Date, coverage = 0): number {
  const perYear = w.cited / ageOf(w.year, now);
  // IDF-like: log of how many times over the popular rate the work is cited.
  const idf = 1 / (1 + Math.log10(1 + perYear / POPULAR_PER_YEAR));
  // A work that nearly all seeds cite carries little information about any of them: the same on the library side.
  const spread = 1 - 0.3 * Math.min(1, Math.max(0, coverage));
  return Math.max(0.25, idf * spread);
}

export function isClassic(w: WorkStats, now: Date): boolean {
  return ageOf(w.year, now) >= CLASSIC_MIN_AGE && w.cited >= CLASSIC_MIN_CITED;
}
