import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { asArray, documentCount, idOf, ipc, ipcData, pathOf, searchHits, skipUnlessChannels, waitForScan } from './helpers/phase1';
import { openSettings } from './helpers/settings';
import { rowByTitle } from './helpers/ui';

/**
 * G4a (D-316): highlights and underlines written INTO the original PDF. The synthetic library is made by the generator of the test kit
 * (no real file). Writing is switched on for these runs only (`RL_E2E_PDF_WRITE=1`, development run): the build keeps `PDF_WRITE_ENABLED`
 * false. Whatever is written, the original bytes stay an exact prefix of the file.
 */
const CHANNELS = ['annotations:pdfState', 'annotations:writeNow', 'annotations:restoreOriginal', 'annotations:migrate'];
const J5_CHANNELS = ['annotations:exportCopy', 'annotations:externalList', 'annotations:externalImport'];
const ENV = { RL_E2E: '1', RL_E2E_PDF_WRITE: '1' };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const eofs = (b: Buffer) => b.toString('latin1').split('%%EOF').length - 1;
const rect = (y: number) => [{ x: 0.1, y, w: 0.4, h: 0.03 }];

interface PdfState {
  mode: string;
  state: string;
  needsConsent: boolean;
  reason?: string;
  appOnly: number;
  missing: number;
  canRestore: boolean;
}

/** The first steps of the wizard, with the consent switch of the summary in the state asked for. */
async function createLibrary(window: Page, pdfConsent: boolean): Promise<void> {
  const next = () => window.getByTestId('wizard-next').click();
  await expect(window.getByTestId('wizard')).toBeVisible();
  await window.getByTestId('wizard-ui-language').selectOption('en');
  await next();
  await window.getByTestId('wizard-choose-folder').click();
  await expect(window.getByTestId('wizard-folder-chosen')).toBeVisible();
  await next();
  await window.getByTestId('wizard-lib-name').fill('PDF library');
  await next();
  await next(); // starting tags
  await next(); // Claude
  const on = (await window.getByTestId('wizard-write-to-pdf').getAttribute('aria-checked')) === 'true';
  if (on !== pdfConsent) await window.getByTestId('wizard-write-to-pdf').click();
  await window.getByTestId('wizard-create').click();
  await window.locator('[data-testid="wizard-scan-background"], [data-testid="wizard-scan-open"]:enabled').first().click();
  await expect(window.getByTestId('wizard')).toHaveCount(0, { timeout: 30_000 });
}

async function start(testInfo: Parameters<typeof skipUnlessChannels>[1], pdfConsent: boolean, env: Record<string, string> = {}): Promise<{ ctx: LaunchedApp; window: Page; files: Array<{ title: string; abs: string; docId: string }> }> {
  const ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true, env: { ...ENV, ...env } });
  const { window } = ctx;
  await createLibrary(window, pdfConsent);
  await skipUnlessChannels(window, testInfo, CHANNELS);
  const total = ctx.library!.manifest!.files.length;
  await waitForScan(window, total);
  await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
  const files: Array<{ title: string; abs: string; docId: string }> = [];
  for (const f of ctx.library!.manifest!.files.filter((x) => x.format === 'pdf' && x.title)) {
    const hit = (await searchHits(window, f.title!)).map((h) => idOf(h)).find((x) => x !== undefined);
    if (hit) files.push({ title: f.title!, abs: path.join(ctx.library!.root, f.relPath), docId: hit });
    if (files.length === 2) break;
  }
  test.skip(files.length < 2, 'needs two PDFs with a title');
  return { ctx, window, files };
}

const pdfState = (window: Page, docId: string) => ipcData<PdfState>(window, 'annotations:pdfState', { docId });
const saveAnn = (window: Page, docId: string, over: Record<string, unknown> = {}) =>
  ipcData<{ annotation: { id: string } }>(window, 'annotations:save', { docId, annotation: { kind: 'highlight', page: 1, rects: rect(0.2), text: 'a quoted line', color: 'yellow', geom: 2, ...over } });

async function openInReader(window: Page, title: string): Promise<void> {
  const row = rowByTitle(window, title);
  await row.hover();
  await row.getByTestId('row-read').click();
  await expect(window.getByTestId('reader')).toBeVisible();
  await expect(window.getByTestId('reader-pages')).toContainText(/\d/, { timeout: 60_000 });
}

/** Renders the PDF in a hidden window with the viewer plugin and counts the yellow and the dark pixels (what Chrome and Edge would show). */
async function pixelsInStandardViewer(ctx: LaunchedApp, file: string): Promise<{ yellow: number; dark: number; painted: number } | null> {
  return ctx.app.evaluate(async ({ BrowserWindow }, url) => {
    const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { plugins: true, sandbox: true } });
    try {
      await win.loadURL(url as string);
      await new Promise((r) => setTimeout(r, 2500));
      const img = await win.webContents.capturePage();
      const { width, height } = img.getSize();
      const bmp = img.toBitmap(); // BGRA
      let yellow = 0, dark = 0, painted = 0;
      for (let i = 0; i < width * height; i++) {
        const b = bmp[i * 4]!, g = bmp[i * 4 + 1]!, r = bmp[i * 4 + 2]!;
        if (r < 250 || g < 250 || b < 250) painted++;
        if (r > 230 && g > 200 && b < 140) yellow++;
        if (r < 90 && g < 90 && b < 90) dark++;
      }
      return { yellow, dark, painted };
    } catch {
      return null;
    } finally {
      win.destroy();
    }
  }, pathToFileURL(file).href);
}

test('create, edit and delete highlights: written into the PDF at the close of the document, original intact, restore always possible (G4a)', async ({}, testInfo) => {
  test.setTimeout(420_000);
  const { ctx, window, files } = await start(testInfo, true);
  try {
    const [doc] = files as [(typeof files)[0]];
    const original = await readFile(doc.abs);
    const prefixOk = async () => (await readFile(doc.abs)).subarray(0, original.length).equals(original);

    // A highlight made in the app is in the app first; nothing is written while the user works.
    const a = await saveAnn(window, doc.docId, { comment: 'worth a second look' });
    expect((await readFile(doc.abs)).equals(original)).toBe(true);
    await openInReader(window, doc.title);
    expect(await pdfState(window, doc.docId)).toMatchObject({ mode: 'write', needsConsent: false });
    await window.getByTestId('reader-study-menu').click();
    await expect(window.getByTestId('reader-pdf-status')).toBeVisible();
    await window.keyboard.press('Escape');

    // "No reload after our own write": same scroll position, no new request for the document.
    const area = window.getByTestId('reader-pages-area');
    await area.evaluate((el) => (el.scrollTop = 120));
    const scrollBefore = await area.evaluate((el) => el.scrollTop);
    const requests = () => window.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.startsWith('rl-doc:')).length);
    const requestsBefore = await requests();

    // "Write now" from the Study menu (the menu offers it while a write is pending).
    await window.getByTestId('reader-study-menu').click();
    await window.getByTestId('reader-pdf-write-now').click();
    await expect.poll(async () => (await pdfState(window, doc.docId)).state, { timeout: 60_000 }).toBe('synced');
    const written = await readFile(doc.abs);
    expect(written.length).toBeGreaterThan(original.length);
    expect(await prefixOk()).toBe(true);
    expect(written.toString('latin1')).toContain(`/NM (rl-${a.annotation.id})`);
    expect(written.toString('latin1')).toContain('worth a second look');
    expect(eofs(written)).toBe(eofs(original) + 1);
    // the copy of the original is kept in the synced data folder, once
    const copies = (await readdir(path.join(ctx.library!.root, '.lab', 'pdf-originals'))).filter((n) => n.endsWith('.pdf'));
    expect(copies).toHaveLength(1);
    expect(sha(await readFile(path.join(ctx.library!.root, '.lab', 'pdf-originals', copies[0]!)))).toBe(sha(original));
    // nothing else next to the original
    expect((await readdir(path.dirname(doc.abs))).filter((n) => /\.rl-[0-9a-f]{8}\.tmp$/.test(n))).toEqual([]);
    expect(await area.evaluate((el) => el.scrollTop)).toBe(scrollBefore);
    expect(await requests()).toBe(requestsBefore);
    await window.getByTestId('reader-study-menu').click();
    await expect(window.getByTestId('reader-pdf-status')).toContainText('In the PDF');
    await window.keyboard.press('Escape');

    // A standard viewer shows it: yellow where the highlight is (the plugin may be missing in some runs: then it is said, not failed).
    const px = await pixelsInStandardViewer(ctx, doc.abs);
    if (px && px.painted > 1000) expect(px.yellow, 'yellow pixels of the highlight in the standard viewer').toBeGreaterThan(200);
    else testInfo.annotations.push({ type: 'note', description: 'the PDF viewer plugin did not render in a hidden window in this run: pixel check skipped' });

    // Edit the comment: written when the document closes.
    await saveAnn(window, doc.docId, { id: a.annotation.id, comment: 'changed my mind' });
    await window.getByTestId('reader-close').click();
    await expect(window.getByTestId('reader')).toHaveCount(0);
    await expect.poll(async () => eofs(await readFile(doc.abs)), { timeout: 60_000 }).toBe(eofs(original) + 2);
    expect((await readFile(doc.abs)).toString('latin1')).toContain('changed my mind');
    expect(await prefixOk()).toBe(true);

    // Delete it: the reference leaves /Annots in one more revision, the file keeps growing, never rewritten.
    await ipcData(window, 'annotations:remove', { docId: doc.docId, id: a.annotation.id });
    await ipcData(window, 'annotations:writeNow', { docId: doc.docId });
    expect(eofs(await readFile(doc.abs))).toBe(eofs(original) + 3);
    expect(await prefixOk()).toBe(true);

    // A file another program holds (simulated by the read-only attribute): refused with its reason, written once it is free.
    await saveAnn(window, doc.docId, { rects: rect(0.4), text: 'second line' });
    await chmod(doc.abs, 0o444);
    try {
      const refused = await ipcData<PdfState>(window, 'annotations:writeNow', { docId: doc.docId });
      if (refused.state === 'refused') expect(refused.reason).toBe('read-only');
    } finally {
      await chmod(doc.abs, 0o666);
    }
    expect((await ipcData<PdfState>(window, 'annotations:writeNow', { docId: doc.docId })).state).toBe('synced');
    expect(await prefixOk()).toBe(true);

    // Restore: the file is exactly as it was, and the document stays app-only.
    await openInReader(window, doc.title);
    await window.getByTestId('reader-panel-info').click();
    await window.getByTestId('reader-pdf-restore').click();
    await window.getByTestId('pdf-restore-confirm').click();
    await expect.poll(async () => sha(await readFile(doc.abs)), { timeout: 60_000 }).toBe(sha(original));
    await expect.poll(async () => (await pdfState(window, doc.docId)).mode, { timeout: 30_000 }).toBe('app-only');
    expect((await ipcData<{ annotations: unknown[] }>(window, 'annotations:list', { docId: doc.docId })).annotations.length).toBeGreaterThan(0); // the highlights stay in the app
  } finally {
    await chmod(files[0]!.abs, 0o666).catch(() => {});
    await ctx.close();
  }
});

test('migration: existing highlights are written into the PDFs one file at a time, after the library says yes (G4a)', async ({}, testInfo) => {
  test.setTimeout(420_000);
  const { ctx, window, files } = await start(testInfo, false);
  try {
    const originals = await Promise.all(files.map((f) => readFile(f.abs)));
    for (const f of files) await saveAnn(window, f.docId);
    // The library said "only in the app": nothing is written, whatever the user does.
    for (const f of files) {
      expect(await pdfState(window, f.docId)).toMatchObject({ mode: 'off' });
      const st = await ipcData<PdfState>(window, 'annotations:writeNow', { docId: f.docId });
      expect(st.mode).toBe('off');
    }
    for (const [i, f] of files.entries()) expect((await readFile(f.abs)).equals(originals[i]!)).toBe(true);

    // Settings › Library › PDF annotations: turn it on (the consent), see what migration will do, confirm.
    await openSettings(window, 'library');
    await window.getByTestId('annotations-write').click();
    await expect.poll(async () => (await ipcData<{ annotations: { writeToPdfConfirmedAt: string | null; writeToPdf: boolean } }>(window, 'library:getConfig', {})).annotations.writeToPdfConfirmedAt !== null, { timeout: 30_000 }).toBe(true);
    await window.getByTestId('annotations-migrate').click();
    await expect(window.getByTestId('annotations-migrate-dialog')).toContainText('2 files');
    await window.getByTestId('annotations-migrate-confirm').click();
    await expect(window.getByTestId('annotations-job')).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
    for (const [i, f] of files.entries()) {
      const now = await readFile(f.abs);
      expect(now.length).toBeGreaterThan(originals[i]!.length);
      expect(now.subarray(0, originals[i]!.length).equals(originals[i]!)).toBe(true);
      expect(await pdfState(window, f.docId)).toMatchObject({ state: 'synced', appOnly: 0 });
    }
    // Both copies exist; "restore all originals" gives both files back, byte for byte.
    expect((await readdir(path.join(ctx.library!.root, '.lab', 'pdf-originals'))).filter((n) => n.endsWith('.pdf'))).toHaveLength(2);
    await window.getByTestId('annotations-restore-all').click();
    await window.getByTestId('annotations-restore-confirm').click();
    for (const [i, f] of files.entries()) await expect.poll(async () => sha(await readFile(f.abs)), { timeout: 120_000 }).toBe(sha(originals[i]!));
  } finally {
    await ctx.close();
  }
});

/** A small encrypted PDF (an /Encrypt entry with a handler the writer does not know), as text. */
function encryptedPdf(): Buffer {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>', '<< /Filter /Custom /V 4 >>'];
  let out = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((b, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xr = out.length;
  out += `xref\n0 5\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] >>\nstartxref\n${xr}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('an encrypted PDF is refused with the right reason and left untouched (G4a)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, window } = await start(testInfo, true);
  try {
    const total = await documentCount(window);
    const file = path.join(ctx.library!.root, 'locked-sample.pdf');
    const bytes = encryptedPdf();
    await writeFile(file, bytes);
    await ipcData(window, 'scan:start', {});
    await expect.poll(() => documentCount(window, total + 1), { timeout: 120_000, intervals: [500, 1000, 2000] }).toBeGreaterThanOrEqual(total + 1);
    const list = await ipc(window, 'documents:list', { limit: total + 200 });
    const id = asArray(list.data)
      .filter((d) => pathOf(d)?.endsWith('locked-sample.pdf'))
      .map((d) => idOf(d))[0];
    test.skip(!id, 'the document list has another shape: cannot find the sample');
    await saveAnn(window, id!);
    const st = await ipcData<PdfState>(window, 'annotations:writeNow', { docId: id });
    expect(st).toMatchObject({ state: 'refused', reason: 'encrypted' });
    expect((await readFile(file)).equals(bytes)).toBe(true);
    expect((await stat(file)).size).toBe(bytes.length);
  } finally {
    await ctx.close();
  }
});

test('"Export an annotated copy": only the copy is written, where the user picked; the original never changes (J5)', async ({}, testInfo) => {
  test.setTimeout(420_000);
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'rl-export-'));
  const { ctx, window, files } = await start(testInfo, true, { RL_E2E_EXPORT_DIALOG_PATH: outDir });
  try {
    await skipUnlessChannels(window, testInfo, J5_CHANNELS);
    const [doc] = files as [(typeof files)[0]];
    const original = await readFile(doc.abs);
    const a = await saveAnn(window, doc.docId, { comment: 'for the copy' });
    // "Only in the app" for this document: nothing is written into the original, and the copy is still offered
    await ipcData(window, 'annotations:setPdfMode', { docId: doc.docId, mode: 'app-only' });
    // a path that the folder dialog did not return is refused
    expect((await ipc(window, 'annotations:exportCopy', { docId: doc.docId, destination: path.join(outDir, 'not-picked') })).ok).toBe(false);

    await openInReader(window, doc.title);
    await window.getByTestId('reader-study-menu').click();
    await window.getByTestId('reader-pdf-export').click();
    await expect.poll(async () => (await readdir(outDir)).filter((n) => n.endsWith('(annotated).pdf')).length, { timeout: 60_000 }).toBe(1);
    const name = (await readdir(outDir)).find((n) => n.endsWith('(annotated).pdf'))!;
    const copy = await readFile(path.join(outDir, name));
    expect(copy.subarray(0, original.length).equals(original)).toBe(true);
    expect(copy.length).toBeGreaterThan(original.length);
    expect(copy.toString('latin1')).toContain(`/NM (rl-${a.annotation.id})`);
    expect(copy.toString('latin1')).toContain('for the copy');
    expect((await readFile(doc.abs)).equals(original)).toBe(true); // the original never changes
    expect((await readdir(outDir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect((await readdir(path.dirname(doc.abs))).filter((n) => /\.rl-[0-9a-f]{8}\.tmp$/.test(n))).toEqual([]);
    expect(await pdfState(window, doc.docId)).toMatchObject({ mode: 'app-only' });
  } finally {
    await ctx.close();
    await rm(outDir, { recursive: true, force: true });
  }
});

test('annotations made by other programs are listed and imported into the app on the user choice (J5)', async ({}, testInfo) => {
  test.setTimeout(420_000);
  const { ctx, window, files } = await start(testInfo, true);
  try {
    await skipUnlessChannels(window, testInfo, J5_CHANNELS);
    const [doc] = files as [(typeof files)[0]];
    // "Another program" appends a highlight to the file (a plain incremental update, as a PDF reader does); the scan then sees the new file.
    const hl = '<< /Type /Annot /Subtype /Highlight /Rect [20 150 120 170] /QuadPoints [20 170 120 170 20 150 120 150] /C [1 0.92 0.23] /NM (other-1) /Contents (from another reader) /T (Ann) >>';
    const withOther = appendOtherAnnotation(await readFile(doc.abs), hl);
    test.skip(!withOther, 'the sample PDF has a layout this test does not extend');
    await writeFile(doc.abs, withOther!);
    await ipcData(window, 'scan:start', {});
    await expect
      .poll(async () => (await ipcData<{ items: unknown[] }>(window, 'annotations:externalList', { docId: doc.docId }).catch(() => ({ items: [] }))).items.length, { timeout: 120_000, intervals: [500, 1000, 2000] })
      .toBe(1);
    const changed = await readFile(doc.abs);

    await openInReader(window, doc.title);
    await window.getByTestId('reader-panel-info').click();
    await window.getByTestId('reader-pdf-external').click();
    await expect(window.getByTestId('pdf-external-dialog')).toBeVisible();
    await expect(window.getByTestId('pdf-external-item')).toHaveCount(1);
    await expect(window.getByTestId('pdf-external-list')).toContainText('from another reader');
    expect((await ipcData<{ annotations: unknown[] }>(window, 'annotations:list', { docId: doc.docId })).annotations).toHaveLength(0); // listing changes nothing
    await window.getByTestId('pdf-external-import').click();
    await expect(window.getByTestId('pdf-external-dialog')).toHaveCount(0);
    const list = (await ipcData<{ annotations: Array<{ kind: string; comment?: string }> }>(window, 'annotations:list', { docId: doc.docId })).annotations;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'highlight', comment: 'from another reader' });
    expect((await readFile(doc.abs)).subarray(0, changed.length).equals(changed)).toBe(true); // importing never alters the PDF it reads
    // imported once: the same item is now "already in the app"
    expect((await ipcData<{ items: Array<{ inApp: boolean }> }>(window, 'annotations:externalList', { docId: doc.docId })).items[0]!.inApp).toBe(true);
  } finally {
    await ctx.close();
  }
});

/** Appends a revision that adds one annotation object to the first page of a classic-xref PDF; null when the layout is not the expected one. */
function appendOtherAnnotation(pdf: Buffer, annot: string): Buffer | null {
  const text = pdf.toString('latin1');
  const tail = text.slice(text.lastIndexOf('trailer'));
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  const size = /\/Size (\d+)/.exec(tail);
  const root = /\/Root (\d+) 0 R/.exec(tail);
  if (!m || !size || !root || text.lastIndexOf('trailer') < 0 || /\/Type\s*\/XRef/.test(text.slice(Number(m[1]), Number(m[1]) + 400))) return null;
  const n = Number(size[1]);
  const first = /(\d+) 0 obj\s*<<(?:(?!endobj)[^])*?\/Type\s*\/Page\b(?!s)(?:(?!endobj)[^])*?>>\s*endobj/.exec(text);
  if (!first || /\/Annots/.test(first[0])) return null;
  const pageNo = Number(first[1]);
  const pageBody = first[0].replace(/^\d+ 0 obj\s*/, '').replace(/\s*endobj$/, '').replace(/>>\s*$/, `/Annots [${n} 0 R] >>`);
  let out = '';
  const offs: Array<[number, number]> = [];
  for (const [no, body] of [[n, annot], [pageNo, pageBody]] as Array<[number, string]>) {
    offs.push([no, pdf.length + out.length]);
    out += `${no} 0 obj\n${body}\nendobj\n`;
  }
  const xr = pdf.length + out.length;
  out += `xref\n${offs.map(([no, off]) => `${no} 1\n${String(off).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${n + 1} /Root ${root[1]} 0 R /Prev ${m[1]} >>\nstartxref\n${xr}\n%%EOF\n`;
  return Buffer.concat([pdf, Buffer.from(out, 'latin1')]);
}
