import { rl } from '../../lib/rl';
import type { EntityNetwork, EntityRequest } from './entityTypes';

/**
 * Data of the entity networks: `graph:entityNetwork` (N4, main process) computes them from the records and the model, with
 * the caps of §4.21.3 and the user's author corrections. Nothing is derived here any more; a failure is the caller's to show.
 */
const fold = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Key of an author as in Explore: family name plus first initial, "Surname, Given" and "Given Surname" alike. */
export function authorKey(name: string): string {
  const comma = name.indexOf(',');
  const parts = (comma >= 0 ? `${name.slice(comma + 1)} ${name.slice(0, comma)}` : name)
    .split(/\s+/)
    .map(fold)
    .filter((p) => p !== '');
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  const family = comma >= 0 ? fold(name.slice(0, comma)) : parts[parts.length - 1]!;
  return `${family} ${parts[0]!.charAt(0)}`;
}

export function fetchEntityNetwork(req: EntityRequest): Promise<EntityNetwork> {
  return rl.invoke('graph:entityNetwork', req) as Promise<EntityNetwork>;
}
