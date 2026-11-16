import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { asArray, createLibraryViaWizard, idOf, ipc, ipcData, pathOf, waitForScan } from './helpers/phase1';

/**
 * Phase 3, data half: the `rl-doc://` scheme (ranges, refusals), notes and annotations through the real channels,
 * persistence across a restart, search by a word that is only in a note or an annotation, the "underlined" flag, and
 * the original PDFs byte-identical at the end. The renderer UI is not involved: channels are called from the page.
 */

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const NOTE_WORD = 'zorblaxquux';
const ANN_WORD = 'wibblequuxer';

interface FetchResult {
  status: number;
  contentRange: string | null;
  contentType: string | null;
  acceptRanges: string | null;
  allowOrigin: string | null;
  bytes: number[];
  error?: string;
}

/** `fetch` of an rl-doc URL from the renderer (the origin the CSP and CORS rules are written for). */
async function fetchDoc(window: Page, url: string, range?: string): Promise<FetchResult> {
  return window.evaluate(
    async ([u, r]) => {
      try {
        const res = await fetch(u as string, r ? { headers: { Range: r as string } } : {});
        const buf = new Uint8Array(await res.arrayBuffer());
        return {
          status: res.status,
          contentRange: res.headers.get('content-range'),
          contentType: res.headers.get('content-type'),
          acceptRanges: res.headers.get('accept-ranges'),
          allowOrigin: res.headers.get('access-control-allow-origin'),
          bytes: Array.from(buf.subarray(0, 4096)),
          length: buf.length,
        } as FetchResult & { length: number };
      } catch (e) {
        return { status: 0, contentRange: null, contentType: null, acceptRanges: null, allowOrigin: null, bytes: [], error: String(e) };
      }
    },
    [url, range ?? ''] as const,
  );
}

async function docIds(window: Page, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const items = asArray(await ipcData(window, 'documents:list', { limit: 200 }));
  for (const it of items) {
    const p = pathOf(it);
    const id = idOf(it);
    if (p && id && paths.includes(p)) out.set(p, id);
  }
  return out;
}

const hitIds = async (window: Page, text: string) => asArray(await ipcData(window, 'search:query', { text, limit: 50 })).map(idOf);

test('rl-doc ranges, notes, annotations, restart, search and untouched originals', async () => {
  test.setTimeout(300_000);
  let ctx1: LaunchedApp | undefined;
  let ctx2: LaunchedApp | undefined;
  try {
    ctx1 = await launchApp({ library: 'papers', dialogPath: true, offline: true });
    const { window } = ctx1;
    const manifest = ctx1.library!.manifest!;
    const root = ctx1.library!.root;
    const pdfs = manifest.files.filter((f) => f.format === 'pdf').slice(0, 2);
    const other = manifest.files.find((f) => f.format !== 'pdf');
    expect(pdfs).toHaveLength(2);

    await createLibraryViaWizard(window, { name: 'Study library' });
    await waitForScan(window, manifest.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });

    const ids = await docIds(window, [...pdfs.map((f) => f.relPath), ...(other ? [other.relPath] : [])]);
    const [d1, d2] = pdfs.map((f) => ids.get(f.relPath)!);
    expect(d1 && d2).toBeTruthy();

    const hashesBefore = await Promise.all(pdfs.map(async (f) => sha(await readFile(path.join(root, f.relPath)))));
    expect(hashesBefore).toEqual(pdfs.map((f) => f.sha256));
    const bytes1 = await readFile(path.join(root, pdfs[0]!.relPath));

    // ---- reader:open and the rl-doc scheme
    const opened = await ipcData<{ url: string; hash: string; title: string | null }>(window, 'reader:open', { docId: d1 });
    expect(opened.url).toBe(`rl-doc://doc/${d1}?v=${opened.hash.slice(0, 8)}`);
    expect(opened.hash).toBe(pdfs[0]!.sha256);

    const head = await fetchDoc(window, opened.url, 'bytes=0-99');
    expect(head.error).toBeUndefined();
    expect(head.status).toBe(206);
    expect(head.contentRange).toBe(`bytes 0-99/${bytes1.length}`);
    expect(head.contentType).toBe('application/pdf');
    expect(head.acceptRanges).toBe('bytes');
    // The fetch itself succeeding is the CORS proof: the browser hides Access-Control-Allow-Origin from scripts.
    expect(Buffer.from(head.bytes).equals(bytes1.subarray(0, 100))).toBe(true);
    expect(Buffer.from(head.bytes.slice(0, 5)).toString()).toBe('%PDF-');

    const mid = await fetchDoc(window, opened.url, 'bytes=200-299');
    expect(mid.status).toBe(206);
    expect(Buffer.from(mid.bytes).equals(bytes1.subarray(200, 300))).toBe(true);
    const tail = await fetchDoc(window, opened.url, 'bytes=-64');
    expect(tail.contentRange).toBe(`bytes ${bytes1.length - 64}-${bytes1.length - 1}/${bytes1.length}`);
    expect(Buffer.from(tail.bytes).equals(bytes1.subarray(bytes1.length - 64))).toBe(true);
    expect((await fetchDoc(window, opened.url, `bytes=${bytes1.length}-`)).status).toBe(416);
    const whole = await fetchDoc(window, opened.url);
    expect(whole.status).toBe(200);
    expect(whole.bytes.length).toBe(Math.min(4096, bytes1.length));

    // Another id, a malformed id and a document that is not a PDF are refused; the answer carries no path.
    const unknown = await fetchDoc(window, 'rl-doc://doc/0000000000000000?v=00000000');
    expect(unknown.status).toBe(404);
    expect(Buffer.from(unknown.bytes).toString()).not.toContain(root);
    expect((await fetchDoc(window, 'rl-doc://doc/not-an-id')).status).toBe(404);
    expect((await fetchDoc(window, 'rl-doc://doc/../../x')).status).toBe(404);
    const refused = await ipc(window, 'reader:open', { docId: '0000000000000000' });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe('NOT_FOUND');
    const otherId = other ? ids.get(other.relPath) : undefined;
    if (otherId) {
      expect((await ipc(window, 'reader:open', { docId: otherId })).error?.code).toBe('PERMISSION_DENIED');
      expect((await fetchDoc(window, `rl-doc://doc/${otherId}?v=00000000`)).status).toBe(403);
    }
    // Links: only http(s) reach the system. (https is not sent here: it would open a browser.)
    for (const url of ['file:///c:/windows/notepad.exe', 'javascript:alert(1)', 'ftp://example.org/x']) {
      expect((await ipc(window, 'reader:openLink', { url })).error?.code).toBe('PERMISSION_DENIED');
    }

    // ---- notes
    expect((await ipcData<{ note: unknown }>(window, 'notes:get', { docId: d1 })).note).toBeNull();
    const fileNote = (await ipcData<{ note: { updatedAt: string } }>(window, 'notes:save', { docId: d1, body: `Whole file ${NOTE_WORD}`, expectedUpdatedAt: null })).note;
    (await ipcData<{ note: { updatedAt: string } }>(window, 'notes:save', { docId: d1, page: 2, body: '## Page two\nsecond page note', expectedUpdatedAt: null })).note;
    const conflict = await ipc(window, 'notes:save', { docId: d1, body: 'stale', expectedUpdatedAt: null });
    expect(conflict.error?.code).toBe('CONFLICT');
    const list = await ipcData<{ items: Array<{ page: number | null; excerpt: string }> }>(window, 'notes:list', { docId: d1 });
    expect(list.items.map((i) => i.page)).toEqual([null, 2]);
    expect(list.items[1]!.excerpt).toBe('Page two second page note');
    // The word is only in the note: the document is found through it, the other one is not.
    await expect.poll(() => hitIds(window, NOTE_WORD), { timeout: 30_000 }).toEqual([d1]);

    // ---- annotations and the flag
    const rect = { x: 0.1, y: 0.1, w: 0.4, h: 0.02 };
    const a1 = await ipcData<{ annotation: { id: string }; underlined: { value: boolean; origin: string } }>(window, 'annotations:save', {
      docId: d1,
      annotation: { kind: 'highlight', page: 1, rects: [rect], text: `quoted ${ANN_WORD}`, color: 'green' },
    });
    expect(a1.underlined).toEqual({ value: true, origin: 'annotations' });
    const a2 = await ipcData<{ annotation: { id: string } }>(window, 'annotations:save', { docId: d1, annotation: { kind: 'underline', page: 2, rects: [rect], text: 'second' } });
    const listed = await ipcData<{ annotations: unknown[]; stale: boolean }>(window, 'annotations:list', { docId: d1 });
    expect(listed.annotations).toHaveLength(2);
    expect(listed.stale).toBe(false);
    await expect.poll(() => hitIds(window, ANN_WORD), { timeout: 30_000 }).toEqual([d1]);
    const rec = await ipcData<{ study: { underlined: { value: boolean; origin: string } } }>(window, 'documents:get', { docId: d1 });
    expect(rec.study.underlined).toEqual({ value: true, origin: 'annotations' });
    // A second document stays clean.
    expect((await ipcData<{ annotations: unknown[] }>(window, 'annotations:list', { docId: d2 })).annotations).toEqual([]);

    // ---- restart on the same data
    await ctx1.app.close();
    ctx2 = await launchApp({ offline: true, env: { RL_USER_DATA_DIR: ctx1.userDataDir, RL_LOCAL_DATA_DIR: ctx1.localDataDir } });
    const w2 = ctx2.window;
    await expect.poll(async () => (await ipc(w2, 'notes:get', { docId: d1 })).ok, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(true);
    const again = await ipcData<{ note: { body: string; updatedAt: string } }>(w2, 'notes:get', { docId: d1 });
    expect(again.note.body).toBe(`Whole file ${NOTE_WORD}`);
    expect(again.note.updatedAt).toBe(fileNote.updatedAt);
    expect((await ipcData<{ note: { body: string } }>(w2, 'notes:get', { docId: d1, page: 2 })).note.body).toContain('second page note');
    const persisted = await ipcData<{ annotations: Array<{ id: string; color: string }> }>(w2, 'annotations:list', { docId: d1 });
    expect(persisted.annotations.map((a) => a.id)).toEqual([a1.annotation.id, a2.annotation.id]);
    expect(persisted.annotations[0]!.color).toBe('green');
    await expect.poll(() => hitIds(w2, NOTE_WORD), { timeout: 60_000 }).toEqual([d1]);
    await expect.poll(() => hitIds(w2, ANN_WORD), { timeout: 60_000 }).toEqual([d1]);
    const reopened = await ipcData<{ url: string }>(w2, 'reader:open', { docId: d1 });
    expect((await fetchDoc(w2, reopened.url, 'bytes=0-9')).status).toBe(206);

    // ---- removal: flag back to false, words no longer found
    expect((await ipcData<{ removed: boolean }>(w2, 'annotations:remove', { docId: d1, id: a1.annotation.id })).removed).toBe(true);
    const last = await ipcData<{ underlined: { value: boolean; origin: string } }>(w2, 'annotations:remove', { docId: d1, id: a2.annotation.id });
    expect(last.underlined).toEqual({ value: false, origin: 'annotations' });
    await expect.poll(() => hitIds(w2, ANN_WORD), { timeout: 30_000 }).toEqual([]);
    const fresh = await ipcData<{ note: { updatedAt: string } }>(w2, 'notes:get', { docId: d1 });
    expect((await ipcData<{ note: unknown }>(w2, 'notes:save', { docId: d1, body: '  ', expectedUpdatedAt: fresh.note.updatedAt })).note).toBeNull();
    await expect.poll(() => hitIds(w2, NOTE_WORD), { timeout: 30_000 }).toEqual([]);

    // ---- the originals did not change by a single byte, and nothing else appeared outside the data folder
    const hashesAfter = await Promise.all(pdfs.map(async (f) => sha(await readFile(path.join(root, f.relPath)))));
    expect(hashesAfter).toEqual(hashesBefore);
    await ctx1.verifyLibraryUntouched();
  } finally {
    await ctx2?.close();
    await ctx1?.close();
  }
});
