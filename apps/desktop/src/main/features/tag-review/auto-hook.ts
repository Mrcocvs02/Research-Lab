import type { MainServices } from '../../ipc/handlers/services.js';

/**
 * Automatic acceptance of vocabulary proposals (D-512), kept tiny because the entry loads it: after the library changed (import, AI
 * tagging, scan) and things settled for a few seconds, the lazy chunk runs once if the setting is on. Changes made by the run itself
 * do not trigger it again.
 */
let timer: NodeJS.Timeout | null = null;
let running = false;
let current: MainServices | null = null;

export function bindAutoAccept(s: MainServices): void {
  current = s;
}

export function noteLibraryChange(kind: string): void {
  if (running || !current || (kind !== 'documents' && kind !== 'taxonomy')) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(), 4000);
  timer.unref();
}

async function run(): Promise<void> {
  const s = current;
  if (!s || running) return;
  running = true;
  try {
    const rt = await s.runtime.require();
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(`${rt.store.dataDir}/tag-review.json`, 'utf8').catch(() => '');
    if (!/"auto":\s*"(?!off")/.test(raw)) return;
    await (await import('./index.js')).autoAccept(s);
  } catch (e) {
    s.log.warn('automatic vocabulary acceptance failed', { error: e });
  } finally {
    running = false;
  }
}
