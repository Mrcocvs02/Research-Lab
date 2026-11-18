import { stat } from 'node:fs/promises';
import { createLibraryStore } from '@rl/data';
import type { MainServices } from '../ipc/handlers/services.js';
import { monthOf, summariseUsage } from './usage.js';

/**
 * Spending of this month over every known library (§10.4), read-only, only when the user clicks. A library whose folder
 * cannot be reached (disk unplugged, cloud folder offline) is skipped and reported, never an error.
 */
export async function usageAll(s: MainServices): Promise<{ totalUsd: number; sends: number; libraries: Array<{ libraryId: string; usd: number | null; reachable: boolean }> }> {
  const month = monthOf(new Date());
  const { profiles } = await s.libraries.list();
  const { deviceId } = await s.settings.get();
  let totalUsd = 0;
  let sends = 0;
  const libraries: Array<{ libraryId: string; usd: number | null; reachable: boolean }> = [];
  for (const p of profiles) {
    try {
      await stat(p.rootPath);
      const store = createLibraryStore({ rootPath: p.rootPath, dataDir: await s.libraries.dataDir(p.id), deviceId, logger: s.log });
      const u = summariseUsage(await store.readLog({ type: 'ai-send', since: `${month}-01T00:00:00.000Z` }), month);
      totalUsd += u.usd;
      sends += u.sends;
      libraries.push({ libraryId: p.id, usd: u.usd, reachable: true });
    } catch {
      libraries.push({ libraryId: p.id, usd: null, reachable: false });
    }
  }
  return { totalUsd, sends, libraries };
}
