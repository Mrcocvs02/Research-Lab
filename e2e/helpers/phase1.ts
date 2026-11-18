import { expect, type Page, type TestInfo } from '@playwright/test';

// Helpers for the phase 1 specs (scan, extraction, search, watcher). They depend as little as possible on the
// exact IPC payloads: channels are called through the raw bridge, results are read through tolerant accessors
// (an array, or an object holding one) and only the obvious fields are used (id, title, page).

export interface IpcResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

/** Calls an IPC channel from the renderer through the raw bridge (the typed `invoke` wraps this). */
export async function ipc(window: Page, channel: string, payload?: unknown): Promise<IpcResult> {
  return window.evaluate(
    async ([c, p]) => {
      const bridge = (window as unknown as { rlBridge: { invokeRaw(c: string, p: unknown): Promise<IpcResult> } }).rlBridge;
      return bridge.invokeRaw(c as string, p);
    },
    [channel, payload] as const,
  );
}

export class IpcError extends Error {
  constructor(readonly channel: string, readonly code: string, message: string) {
    super(`${channel} failed: ${code}: ${message}`);
  }
}

/** Like `ipc` but returns the data and throws `IpcError` on failure. */
export async function ipcData<T = unknown>(window: Page, channel: string, payload?: unknown): Promise<T> {
  const r = await ipc(window, channel, payload);
  if (!r.ok) throw new IpcError(channel, r.error?.code ?? 'UNKNOWN', r.error?.message ?? '');
  return r.data as T;
}

/**
 * Channels of the phase 1 runtime that may not be merged yet. A channel is missing when the preload refuses
 * its name (UNKNOWN_CHANNEL) or the main process has no handler (NOT_IMPLEMENTED). The probe sends a payload
 * no schema accepts, so it never triggers the action.
 */
export async function missingChannels(window: Page, channels: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const c of channels) {
    const r = await ipc(window, c, 42);
    if (!r.ok && (r.error?.code === 'UNKNOWN_CHANNEL' || r.error?.code === 'NOT_IMPLEMENTED')) missing.push(c);
  }
  return missing;
}

/** Skips the test, with a clear message, when any of the channels does not exist yet. */
export async function skipUnlessChannels(window: Page, testInfo: TestInfo, channels: string[]): Promise<void> {
  const missing = await missingChannels(window, channels);
  testInfo.skip(missing.length > 0, `phase 1 runtime not merged yet: missing IPC channel(s) ${missing.join(', ')}`);
}

export const PHASE1_CHANNELS = ['scan:start', 'scan:status', 'search:query', 'search:facets', 'documents:list', 'documents:get', 'index:rebuild'];

/* ----------------------------- tolerant readers ----------------------------- */

/** An array, or the first array property of an object (`items`, `documents`, `hits`, `results`, ...). */
export function asArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['items', 'documents', 'hits', 'results', 'records', 'rows']) {
      const v = (data as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
    for (const v of Object.values(data)) if (Array.isArray(v)) return v;
  }
  return [];
}

/** Total count: `total` / `count` when the response carries one, else the array length. */
export function totalOf(data: unknown): number {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of ['total', 'count', 'totalCount']) {
      const v = (data as Record<string, unknown>)[key];
      if (typeof v === 'number') return v;
    }
  }
  return asArray(data).length;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Document id of a hit or document record (`docId`, `id`, or a nested `document`/`record`). */
export function idOf(item: unknown): string | undefined {
  const o = (item ?? {}) as Obj;
  return str(o.docId) ?? str(o.id) ?? idOf2(o.document) ?? idOf2(o.record);
}
const idOf2 = (v: unknown): string | undefined => (v && typeof v === 'object' ? str((v as Obj).docId) ?? str((v as Obj).id) : undefined);

export function titleOf(item: unknown): string | undefined {
  const o = (item ?? {}) as Obj;
  const nested = (v: unknown) => (v && typeof v === 'object' ? str((v as Obj).title) : undefined);
  return str(o.title) ?? nested(o.document) ?? nested(o.record);
}

export function pageOf(item: unknown): number | undefined {
  const o = (item ?? {}) as Obj;
  return typeof o.page === 'number' ? o.page : undefined;
}

export function pathOf(item: unknown): string | undefined {
  const o = (item ?? {}) as Obj;
  const nested = (v: unknown) => (v && typeof v === 'object' ? str((v as Obj).path) : undefined);
  return str(o.path) ?? nested(o.document) ?? nested(o.record);
}

/* --------------------------------- actions --------------------------------- */

export async function searchHits(window: Page, text: string, limit = 20): Promise<unknown[]> {
  return asArray(await ipcData(window, 'search:query', { text, limit }));
}

/** `{ id }` first, then `{ docId }`: the payload key is decided by the runtime. */
export async function getDocument(window: Page, id: string): Promise<unknown> {
  const first = await ipc(window, 'documents:get', { id });
  if (first.ok) return first.data;
  const second = await ipc(window, 'documents:get', { docId: id });
  if (second.ok) return second.data;
  throw new IpcError('documents:get', first.error?.code ?? 'UNKNOWN', first.error?.message ?? '');
}

/** Number of documents known to the library, asking for a page large enough when the channel paginates. */
export async function documentCount(window: Page, expectedAtLeast = 0): Promise<number> {
  const sized = await ipc(window, 'documents:list', { limit: Math.max(expectedAtLeast + 100, 200) });
  if (sized.ok) return totalOf(sized.data);
  return totalOf(await ipcData(window, 'documents:list', {}));
}

export interface WizardOptions {
  name?: string;
  /** The library root holds an old index, so the wizard shows the import step: it is left unchecked. */
  legacyStep?: boolean;
}

/**
 * Runs the first-run wizard on the folder returned by the dialog override (`dialogPath: true`). Documents are
 * not imported from any old index: the scan is what is under test.
 */
export async function createLibraryViaWizard(window: Page, options: WizardOptions = {}): Promise<void> {
  const next = () => window.getByTestId('wizard-next').click();
  await expect(window.getByTestId('wizard')).toBeVisible();
  await window.getByTestId('wizard-ui-language').selectOption('en');
  await next(); // welcome and language
  await window.getByTestId('wizard-choose-folder').click();
  await expect(window.getByTestId('wizard-folder-chosen')).toBeVisible();
  await next();
  await window.getByTestId('wizard-lib-name').fill(options.name ?? 'Test library');
  await next(); // details
  if (options.legacyStep) {
    await expect(window.getByTestId('legacy-preview')).toBeVisible();
    await window.getByTestId('wizard-import-legacy').uncheck();
    await next();
  }
  await next(); // starting tags (empty)
  await next(); // Claude: no folder enabled, nothing to confirm
  await window.getByTestId('wizard-create').click();
  // The seventh step is the first scan: it goes on in the background, the app is usable at once.
  await window.locator('[data-testid="wizard-scan-background"], [data-testid="wizard-scan-open"]:enabled').first().click();
  await expect(window.getByTestId('wizard')).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Waits until the scan has produced `expected` documents. If nothing is running a few seconds after the
 * library was created, the scan is started through `scan:start`. Returns the elapsed milliseconds since the call.
 */
export async function waitForScan(window: Page, expected: number, timeoutMs = 300_000): Promise<number> {
  const t0 = Date.now();
  await expect(window.getByTestId('scan-status')).toBeVisible({ timeout: 60_000 }).catch(async () => {
    // No status bar yet: start the scan explicitly (the library may not scan by itself on creation).
    await ipcData(window, 'scan:start', {});
    await expect(window.getByTestId('scan-status')).toBeVisible({ timeout: 60_000 });
  });
  await expect.poll(() => documentCount(window, expected), { timeout: timeoutMs, intervals: [250, 500, 1000, 2000] }).toBeGreaterThanOrEqual(expected);
  return Date.now() - t0;
}

/** Makes the search box reachable (the library section may not be the one shown) and returns nothing. */
export async function openSearch(window: Page): Promise<void> {
  const input = window.getByTestId('search-input');
  if (await input.isVisible()) return;
  const nav = window.getByTestId('nav-library');
  if ((await nav.count()) > 0) await nav.click();
  await expect(input, 'search box (test id search-input) not found in the interface').toBeVisible({ timeout: 15_000 });
}

/** Types in the search box and waits for the result list to settle on at least one entry (or none when `expectNone`). */
export async function searchViaUi(window: Page, text: string): Promise<string[]> {
  await openSearch(window);
  const input = window.getByTestId('search-input');
  await input.fill(text);
  await input.press('Enter').catch(() => {});
  // Wait for the answer to this very text, not a list left over from an earlier query.
  const pane = window.getByTestId('results-pane');
  await expect(pane).toHaveAttribute('data-query', text, { timeout: 30_000 });
  await expect(pane).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  const results = window.getByTestId('search-result');
  await expect(results.first()).toBeVisible({ timeout: 30_000 });
  return results.allTextContents();
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

/**
 * Waits for a scan whose result size is not known in advance: documents appear, then stop changing for
 * `stableMs`. Needs the status bar to be there (a scan was started).
 */
export async function waitForScanSettled(window: Page, timeoutMs = 600_000, stableMs = 4_000): Promise<number> {
  await expect(window.getByTestId('scan-status')).toBeVisible({ timeout: 60_000 }).catch(async () => {
    await ipcData(window, 'scan:start', {});
    await expect(window.getByTestId('scan-status')).toBeVisible({ timeout: 60_000 });
  });
  let last = -1;
  let since = Date.now();
  await expect
    .poll(
      async () => {
        const n = await documentCount(window, 5000);
        if (n !== last) {
          last = n;
          since = Date.now();
        }
        return n > 0 && Date.now() - since >= stableMs;
      },
      { timeout: timeoutMs, intervals: [500, 1000, 1000, 2000] },
    )
    .toBe(true);
  return last;
}
