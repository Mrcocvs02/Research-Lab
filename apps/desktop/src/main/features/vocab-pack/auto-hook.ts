import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MainServices } from '../../ipc/handlers/services.js';

/**
 * The field vocabulary applied by itself (D-565), kept tiny because the entry loads it: after the library was opened or changed (a scan,
 * an import) and things settled for a few seconds, the lazy chunk runs once, only when the library never decided about a pack. A library
 * that did (a pack in use, the suggestion dismissed, the pack turned off) costs one small file read.
 */
const STATE_FILE = 'vocab-pack.json';
let timer: NodeJS.Timeout | null = null;
let running = false;
let current: MainServices | null = null;

export function bindPackAuto(s: MainServices): void {
  current = s;
}

/** The library was opened, scanned or changed (`kind`: the `library:changed` kinds, `scan`, `open`). */
export function notePackAuto(kind: string): void {
  if (running || !current || (kind !== 'documents' && kind !== 'taxonomy' && kind !== 'scan' && kind !== 'open')) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(), 6000);
  timer.unref();
}

async function run(): Promise<void> {
  const s = current;
  if (!s || running) return;
  running = true;
  try {
    const rt = await s.runtime.require();
    const raw = await readFile(path.join(rt.store.dataDir, STATE_FILE), 'utf8').catch(() => '');
    const st = raw ? (JSON.parse(raw) as { packId?: unknown; suggested?: unknown; dismissed?: unknown }) : {};
    if ((typeof st.packId === 'string' && st.packId !== '') || st.suggested === true || st.dismissed === true) return;
    await (await import('./auto.js')).autoApply(s);
  } catch (e) {
    s.log.warn('automatic field vocabulary failed', { error: e });
  } finally {
    running = false;
  }
}
