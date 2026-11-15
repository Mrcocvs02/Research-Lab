import { createHash } from 'node:crypto';

/**
 * Canonical form of a tag / venue / type name for matching:
 * lower case, accents stripped, `_` treated as a space, whitespace collapsed.
 */
export function normalizeName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** URL-safe slug usable as an item id (`itemIdSchema`). Never empty. */
export function slugify(input: string): string {
  const base = normalizeName(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
  if (base) return base;
  return `x-${createHash('sha256').update(input).digest('hex').slice(0, 8)}`;
}

/** Name -> id lookup that tolerates case, accents, spacing and aliases. */
export class NameIndex {
  private readonly map = new Map<string, string>();

  /** Registers a name for an id. Returns false (and keeps the first owner) when already taken by another id. */
  add(name: string, id: string): boolean {
    const key = normalizeName(name);
    if (!key) return true;
    const owner = this.map.get(key);
    if (owner !== undefined) return owner === id;
    this.map.set(key, id);
    return true;
  }

  resolve(name: string): string | undefined {
    return this.map.get(normalizeName(name));
  }
}

/** Returns an id based on `slug` that is not in `taken`, and adds it to `taken`. */
export function uniqueId(slug: string, taken: Set<string>): string {
  let id = slug;
  for (let i = 2; taken.has(id); i++) id = `${slug.slice(0, 120)}-${i}`;
  taken.add(id);
  return id;
}
