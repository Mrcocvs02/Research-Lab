import { expect, test } from '@playwright/test';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, documentCount, ipcData, searchHits } from './helpers/phase1';

/**
 * A PDF made to keep the extractor busy for as long as possible: one page whose content stream holds millions of
 * text operators. Whatever the extractor does with it (finish, give up, block the thread), the scan must end.
 */
async function writeHostilePdf(file: string, operators: number): Promise<void> {
  const op = Buffer.from('BT /F1 9 Tf 1 0 0 1 10 10 Tm (x) Tj ET\n');
  const stream = Buffer.concat(Array.from({ length: 1000 }, () => op));
  const repeat = Math.ceil(operators / 1000);
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    chunks.push(buf);
    length += buf.length;
  };
  push('%PDF-1.4\n');
  const obj = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
  offsets[4] = length;
  push(`4 0 obj\n<< /Length ${stream.length * repeat} >>\nstream\n`);
  for (let i = 0; i < repeat; i++) push(stream);
  push('\nendstream\nendobj\n');
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.concat(chunks));
}

/**
 * Security (D-070): a hostile PDF among normal documents costs one failed file. The scan ends, the normal documents
 * are searchable, and the app quits. The watchdog times are shortened for the run (test hook, ignored by an
 * installed app); the file may also be handled by the extractor's own limits, either way the scan must finish.
 */
test('a hostile PDF does not stop the scan: normal documents are indexed and searchable, the app closes @heavy', async () => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({
      library: 'papers',
      dialogPath: true,
      offline: true,
      env: { RL_WORKER_FILE_TIMEOUT_MS: '5000', RL_WORKER_PAGE_TIMEOUT_MS: '5000' },
    });
    const { window } = ctx;
    const papers = ctx.library!.manifest!.byKind('paper').filter((f) => f.hasText && f.format === 'pdf');
    expect(papers.length).toBeGreaterThan(0);
    const paper = papers[0]!;
    // Sorted before the papers' own folders so that it is met early in the extraction.
    await writeHostilePdf(path.join(ctx.library!.root, '000-hostile', 'operators.pdf'), 1_500_000);

    await createLibraryViaWizard(window, { name: 'Hostile library' });
    const status = window.getByTestId('scan-status');
    await expect(status).toBeVisible({ timeout: 60_000 });
    await expect(status).toHaveAttribute('data-state', 'done', { timeout: 240_000 });

    // Every document is listed (the hostile one too, by its metadata), the normal ones are found by their text.
    const total = await documentCount(window, 1);
    expect(total).toBeGreaterThanOrEqual(papers.length + 1);
    const titleWord = paper.title!.split(/\s+/).sort((a, b) => b.length - a.length)[0]!.replace(/[^\p{L}\p{N}]/gu, '');
    await expect.poll(async () => (await searchHits(window, titleWord)).length, { timeout: 60_000 }).toBeGreaterThan(0);
    const body = (paper as unknown as { body?: string }).body;
    const bodyWord = (body ?? 'quadratically').split(/\s+/).find((w) => /^[a-z]{9,}$/.test(w)) ?? 'quadratically';
    await expect.poll(async () => (await searchHits(window, bodyWord)).length, { timeout: 60_000 }).toBeGreaterThan(0);

    // The scan can be asked again and cancelled without hanging the app.
    await ipcData(window, 'scan:start', {});
    await ipcData(window, 'scan:cancel', {});
    await expect(status).toHaveAttribute('data-state', /^(done|cancelled)$/, { timeout: 60_000 });

    await ctx.verifyLibraryUntouched(['000-hostile']);

    // What happened to the hostile file is in the log (code and reason only): killed by the watchdog or refused by the extractor.
    const logDir = path.join(ctx.localDataDir, 'logs');
    const logText = (await Promise.all((await readdir(logDir)).map((f) => readFile(path.join(logDir, f), 'utf8').catch(() => '')))).join('\n');
    const outcome = /worker killed by the watchdog/.test(logText) ? 'killed by the watchdog' : /text extraction failed/.test(logText) ? 'refused by the extractor' : 'extracted';
    console.info(`[hostile-scan] hostile PDF: ${outcome}`);
    test.info().annotations.push({ type: 'hostile-outcome', description: outcome });

    // The app quits (before-quit closes the runtime with a limit, then the worker is killed).
    const t0 = Date.now();
    await Promise.race([ctx.app.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('the app did not quit in time')), 45_000))]);
    expect(Date.now() - t0).toBeLessThan(45_000);
  } finally {
    await ctx?.close();
  }
});
