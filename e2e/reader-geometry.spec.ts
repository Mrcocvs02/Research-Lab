import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { documentIdFromHash } from '@rl/core';
import { PDFDocument } from 'pdf-lib';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { leakedRules } from './helpers/leaked-rules';
import { ipcData, skipUnlessChannels } from './helpers/phase1';
import { openSyntheticLibrary, rowByTitle } from './helpers/ui';

/**
 * H0 (D-346, D-347): the PDF page is as wide as its MediaBox says at every window size and pixel density, the CSS of
 * pdf.js reaches nothing outside the reader, a new highlight lies on the glyphs, and highlights saved while the page was
 * stretched are measured again from their text.
 */
const CHANNELS = ['reader:open', 'annotations:save', 'annotations:list'];
const TOL = 0.005;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Ann {
  id: string;
  page: number;
  rects: Rect[];
  text: string;
  geom?: number;
}

const inter = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const area = (r: Rect) => r.w * r.h;
/** Intersection over union of two sets of rectangles. */
function iou(a: Rect[], b: Rect[]): number {
  const i = a.reduce((n, ra) => n + b.reduce((m, rb) => m + inter(ra, rb), 0), 0);
  const u = a.reduce((n, r) => n + area(r), 0) + b.reduce((n, r) => n + area(r), 0) - i;
  return u <= 0 ? 0 : i / u;
}

test.describe.serial('reader geometry (H0)', () => {
  let ctx: LaunchedApp;
  let window: Page;
  let title = '';
  let docId = '';
  let media = { w: 1, h: 1 };
  const report: string[] = [];

  /** Sets the size and the pixel density of the page like a monitor would (hidden windows included). */
  async function setViewport(width: number, height: number, dpr: number): Promise<void> {
    const cdp = await window.context().newCDPSession(window);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
    await expect.poll(() => window.evaluate(() => [innerWidth, Math.round(devicePixelRatio * 1000) / 1000]), { timeout: 10_000 }).toEqual([width, dpr]);
  }

  /** Waits until page 1 is drawn and its box stopped changing. */
  async function settle(): Promise<void> {
    let last = '';
    let same = 0;
    await expect
      .poll(
        async () => {
          const sig = await window.evaluate(() => {
            const p = document.querySelector<HTMLElement>('.reader-scroll .page[data-page-number="1"]');
            const c = p?.querySelector('canvas');
            const t = p?.querySelector('.textLayer span');
            if (!p || !c || !t || p.dataset['loaded'] !== 'true') return '';
            const r = p.getBoundingClientRect();
            return `${r.width}x${r.height}:${c.width}x${c.height}`;
          });
          same = sig !== '' && sig === last ? same + 1 : 0;
          last = sig;
          return same;
        },
        { timeout: 60_000, intervals: [250] },
      )
      .toBeGreaterThanOrEqual(3);
  }

  async function openReader(): Promise<void> {
    if ((await window.getByTestId('reader').count()) > 0) await window.getByTestId('reader-close').click();
    const row = rowByTitle(window, title);
    await row.hover();
    await row.getByTestId('row-read').click();
    await expect(window.getByTestId('reader')).toBeVisible();
    await expect(window.getByTestId('reader-error')).toHaveCount(0);
    await settle();
  }

  /** A line of page 1 that occurs once on the page, selected as a user dragging over it would. Returns its text. */
  async function selectUniqueLine(): Promise<string> {
    const text = await window.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.reader-scroll .page[data-page-number="1"] .textLayer span'));
      const compact = (v: string) => v.toLowerCase().replace(/[\s-]/g, '');
      const all = compact(spans.map((s) => s.textContent ?? '').join(''));
      for (const el of spans) {
        const t = (el.textContent ?? '').trim();
        if (t.length < 10 || !/[a-z]{4,}/i.test(t) || all.split(compact(t)).length !== 2) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = document.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return t;
      }
      return '';
    });
    expect(text, 'page 1 needs a line of text that is not repeated').not.toBe('');
    return text;
  }

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(300_000);
    const opened = await openSyntheticLibrary(testInfo, 'papers');
    ctx = opened.ctx;
    window = opened.window;
    await skipUnlessChannels(window, testInfo, CHANNELS);
    const file = ctx.library!.manifest!.files.find((f) => f.format === 'pdf' && f.title && f.hasText !== false);
    test.skip(!file, 'needs a PDF with text and a title');
    title = file!.title!;
    const size = (await PDFDocument.load(await readFile(path.join(ctx.library!.root, file!.relPath)))).getPage(0).getSize();
    media = { w: size.width, h: size.height };
    await window.getByTestId('search-sort').selectOption('title');
    docId = documentIdFromHash(file!.sha256);
  });

  test.afterAll(async () => {
    console.log(`H0 measurements\n${report.join('\n')}`);
    await ctx?.close();
  });

  test('page box, canvas and text layer keep the MediaBox ratio at every size and density', async () => {
    test.setTimeout(240_000);
    await openReader();
    const cases: Array<[number, number, number]> = [
      [1024, 700, 1],
      [1280, 800, 1],
      [1920, 1080, 1],
      [1024, 700, 1.198],
      [1280, 800, 1.198],
      [1920, 1080, 1.198],
      [1280, 800, 1.5],
      [1920, 1080, 1.5],
    ];
    const mediaRatio = media.w / media.h;
    for (const [w, h, dpr] of cases) {
      await setViewport(w, h, dpr);
      await settle();
      const m = await window.evaluate(() => {
        const scroll = document.querySelector<HTMLElement>('.reader-scroll')!;
        const p = scroll.querySelector<HTMLElement>('.page[data-page-number="1"]')!;
        const c = p.querySelector('canvas')!;
        const t = p.querySelector<HTMLElement>('.textLayer')!;
        const pr = p.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        const tr = t.getBoundingClientRect();
        return { pw: pr.width, ph: pr.height, cw: cr.width, ch: cr.height, bw: c.width, bh: c.height, tw: tr.width, th: tr.height, hscroll: scroll.scrollWidth - scroll.clientWidth };
      });
      const label = `${w}x${h}@${dpr}`;
      const boxRatio = m.pw / m.ph;
      report.push(`${label}: box ${m.pw.toFixed(1)}x${m.ph.toFixed(1)} ratio/MediaBox ${(boxRatio / mediaRatio).toFixed(4)}, bitmap/box ${(m.bw / m.bh / (m.cw / m.ch)).toFixed(4)}, text/canvas ${(m.tw / m.cw).toFixed(4)}`);
      expect(Math.abs(boxRatio / mediaRatio - 1), `${label} page box vs MediaBox`).toBeLessThan(TOL);
      expect(Math.abs(m.bw / m.bh / (m.cw / m.ch) - 1), `${label} bitmap vs canvas box`).toBeLessThan(TOL);
      expect(Math.abs(m.cw / m.pw - 1), `${label} canvas width vs page`).toBeLessThan(TOL);
      expect(Math.abs(m.tw / m.cw - 1), `${label} text layer vs canvas`).toBeLessThan(TOL);
      expect(Math.abs(m.th / m.ch - 1), `${label} text layer height vs canvas`).toBeLessThan(TOL);
      expect(m.hscroll, `${label} no horizontal scroll`).toBeLessThanOrEqual(1);
    }
    await setViewport(1280, 800, 1);
  });

  test('nothing of the pdf.js sheet reaches the app, and the sidebar and dialogs look the same after the reader', async () => {
    await openReader();
    const report = await leakedRules(window);
    expect(report.rules, 'the pdf.js sheet must be loaded for this check to mean anything').toBeGreaterThan(20);
    expect(report.unscoped).toEqual([]);
    expect(report.leaked).toEqual([]);

    const sample = () =>
      window.evaluate(() => {
        const pick = (el: Element | null) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          return ['borderRadius', 'boxShadow', 'paddingTop', 'paddingLeft', 'borderTopWidth', 'position', 'width'].map((k) => `${k}=${s.getPropertyValue(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))}`).join(';');
        };
        // A probe in the position a dialog has: the class alone must give the same style whether the reader was opened or not.
        const probe = document.createElement('div');
        probe.className = 'rl-dialog';
        document.body.append(probe);
        const dialog = pick(probe);
        probe.remove();
        return { sidebar: pick(document.querySelector('.app-sidebar')), dialog };
      });
    const after = await sample();
    await window.getByTestId('reader-close').click();
    await expect(window.getByTestId('reader')).toHaveCount(0);
    // The reader's styles stay loaded after it closes: that is the case the audit measured.
    expect(await sample()).toEqual(after);
    expect(after.sidebar).not.toBeNull();
    expect(after.sidebar).not.toContain('border-radius=8px');
  });

  test('a new highlight at 1920 px lies on the glyphs and is saved with geom 2', async () => {
    await setViewport(1920, 1080, 1);
    await openReader();
    await selectUniqueLine();
    await expect(window.getByTestId('annotation-bar')).toBeVisible({ timeout: 10_000 });
    const selected = await window.evaluate(() => {
      const page = document.querySelector<HTMLElement>('.reader-scroll .page[data-page-number="1"]')!;
      const pr = page.getBoundingClientRect();
      const range = document.getSelection()!.getRangeAt(0);
      return Array.from(range.getClientRects()).map((r) => ({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height }));
    });
    await window.getByTestId('ann-highlight').click();
    await expect(window.getByTestId('annotation-mark').first()).toBeVisible();
    const marks = await window.evaluate(() => {
      const page = document.querySelector<HTMLElement>('.reader-scroll .page[data-page-number="1"]')!;
      const pr = page.getBoundingClientRect();
      return Array.from(page.querySelectorAll('[data-testid="annotation-mark"]')).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height };
      });
    });
    const overlap = iou(marks, selected);
    report.push(`1920 new highlight overlap with the glyphs: ${(overlap * 100).toFixed(1)}%`);
    expect(overlap).toBeGreaterThanOrEqual(0.95);
    const saved = await ipcData<{ annotations: Ann[] }>(window, 'annotations:list', { docId });
    expect(saved.annotations.length).toBeGreaterThan(0);
    for (const a of saved.annotations) expect(a.geom).toBe(2);
    await setViewport(1280, 800, 1);
  });

  test('highlights saved while the page was stretched are measured again from their text', async () => {
    test.setTimeout(180_000);
    const list = await ipcData<{ annotations: Ann[] }>(window, 'annotations:list', { docId });
    const good = list.annotations[0]!;
    expect(good.text).not.toBe('');
    // What the old reader stored at 1920 px: x and width stretched by 1.49 and cut at 1, y and height right.
    const k = 1.49;
    const stretched = good.rects.map((r) => {
      const x = Math.min(1, r.x * k);
      return { x, y: r.y, w: Math.min(1 - x, r.w * k), h: r.h };
    });
    const input = (rects: Rect[], text: string) => ({ kind: 'highlight', page: 1, rects, text, color: 'blue' });
    const legacy = await ipcData<{ annotation: Ann }>(window, 'annotations:save', { docId, annotation: input(stretched, good.text) });
    const noText = await ipcData<{ annotation: Ann }>(window, 'annotations:save', { docId, annotation: input(stretched, '') });
    const lost = await ipcData<{ annotation: Ann }>(window, 'annotations:save', { docId, annotation: input(stretched, 'zz qq text that is not on this page') });
    expect(iou(legacy.annotation.rects, good.rects)).toBeLessThan(0.7);
    expect(legacy.annotation.geom).toBeUndefined();

    await setViewport(1920, 1080, 1);
    await openReader();
    await expect
      .poll(async () => (await ipcData<{ annotations: Ann[] }>(window, 'annotations:list', { docId })).annotations.find((a) => a.id === legacy.annotation.id)?.geom, { timeout: 60_000 })
      .toBe(2);
    const after = (await ipcData<{ annotations: Ann[] }>(window, 'annotations:list', { docId })).annotations;
    const fixed = after.find((a) => a.id === legacy.annotation.id)!;
    const overlap = iou(fixed.rects, good.rects);
    report.push(`repaired legacy highlight overlap with the right place: ${(overlap * 100).toFixed(1)}%`);
    expect(overlap).toBeGreaterThanOrEqual(0.95);
    expect(after.find((a) => a.id === good.id)!.rects).toEqual(good.rects);

    // The two that cannot be placed wait in "To check", unchanged.
    const review = window.getByTestId('annotation-review');
    await expect(review).toBeVisible();
    await expect(window.getByTestId('annotation-review-item')).toHaveCount(2);
    for (const a of [noText.annotation, lost.annotation]) {
      const now = after.find((x) => x.id === a.id)!;
      expect(now.geom).toBeUndefined();
      expect(now.rects).toEqual(stretched);
    }
    // "Keep as is" settles one: it leaves the group and counts as checked.
    await window.getByTestId('annotation-review-item').first().getByTestId('ann-accept').click();
    await expect(window.getByTestId('annotation-review-item')).toHaveCount(1);
    await setViewport(1280, 800, 1);
  });
});

/**
 * R0 (D-373): at the first start after the update, a background job places the highlights that were saved while the page
 * was stretched, from the text of the PDF and without opening the reader. App A makes the data (a right highlight from
 * the reader, stretched copies of it, two that cannot be placed) with the job held off; app B starts on the same data and
 * the job runs. The PDF files are never written.
 */
test.describe.serial('annotation check job (R0)', () => {
  let a: LaunchedApp;
  let b: LaunchedApp | undefined;
  let docId = '';
  let good: Ann;
  let legacy: Ann;
  let noText: Ann;
  let lost: Ann;
  let stretched: Rect[] = [];

  test.afterAll(async () => {
    await b?.close();
    await a?.close();
  });

  test('the job places stretched highlights from the PDF text, leaves the rest, and undo clears geom', async ({}, testInfo) => {
    test.setTimeout(420_000);
    process.env['RL_REPAIR_DELAY_MS'] = '3600000'; // app A: the job waits, the data stays as the old reader made it
    try {
      const opened = await openSyntheticLibrary(testInfo, 'papers');
      a = opened.ctx;
    } finally {
      delete process.env['RL_REPAIR_DELAY_MS'];
    }
    const win = a.window;
    await skipUnlessChannels(win, testInfo, CHANNELS);
    const file = a.library!.manifest!.files.find((f) => f.format === 'pdf' && f.title && f.hasText !== false);
    test.skip(!file, 'needs a PDF with text and a title');
    docId = documentIdFromHash(file!.sha256);
    await win.getByTestId('search-sort').selectOption('title');

    // The reader makes the right highlight (geom 2): the ground truth, measured on the drawn text.
    const row = rowByTitle(win, file!.title!);
    await row.hover();
    await row.getByTestId('row-read').click();
    await expect(win.getByTestId('reader')).toBeVisible();
    await expect
      .poll(() => win.evaluate(() => !!document.querySelector('.reader-scroll .page[data-page-number="1"] .textLayer span')), { timeout: 60_000 })
      .toBe(true);
    await win.waitForTimeout(1500);
    const picked = await win.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('.reader-scroll .page[data-page-number="1"] .textLayer span'));
      const compact = (v: string) => v.toLowerCase().replace(/[\s-]/g, '');
      const all = compact(spans.map((s) => s.textContent ?? '').join(''));
      for (const el of spans) {
        const t = (el.textContent ?? '').trim();
        if (t.length < 10 || !/[a-z]{4,}/i.test(t) || all.split(compact(t)).length !== 2) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = document.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        return t;
      }
      return '';
    });
    expect(picked, 'page 1 needs a line of text that is not repeated').not.toBe('');
    await expect(win.getByTestId('annotation-bar')).toBeVisible({ timeout: 10_000 });
    await win.getByTestId('ann-highlight').click();
    await expect(win.getByTestId('annotation-mark').first()).toBeVisible();
    good = (await ipcData<{ annotations: Ann[] }>(win, 'annotations:list', { docId })).annotations[0]!;
    expect(good.geom).toBe(2);
    await win.getByTestId('reader-close').click();

    // What the old reader stored: x and width stretched by 1.49 and cut at 1.
    stretched = good.rects.map((r) => {
      const x = Math.min(1, r.x * 1.49);
      return { x, y: r.y, w: Math.min(1 - x, r.w * 1.49), h: r.h };
    });
    const input = (text: string) => ({ kind: 'highlight', page: 1, rects: stretched, text, color: 'blue' });
    legacy = (await ipcData<{ annotation: Ann }>(win, 'annotations:save', { docId, annotation: input(good.text) })).annotation;
    noText = (await ipcData<{ annotation: Ann }>(win, 'annotations:save', { docId, annotation: input('') })).annotation;
    lost = (await ipcData<{ annotation: Ann }>(win, 'annotations:save', { docId, annotation: input('zz qq text that is not on this page') })).annotation;
    expect(legacy.geom).toBeUndefined();
    expect(iou(legacy.rects, good.rects)).toBeLessThan(0.7);

    // Second start on the same data: the job runs by itself, nobody opens the reader.
    await a.app.close();
    b = await launchApp({ offline: true, env: { RL_USER_DATA_DIR: a.userDataDir, RL_LOCAL_DATA_DIR: a.localDataDir, RL_REPAIR_DELAY_MS: '500' } });
    const list = () => ipcData<{ annotations: Ann[] }>(b!.window, 'annotations:list', { docId }).then((r) => r.annotations);
    await expect.poll(async () => (await list()).find((x) => x.id === legacy.id)?.geom, { timeout: 180_000, intervals: [1000] }).toBe(2);

    const after = await list();
    const fixed = after.find((x) => x.id === legacy.id)!;
    const overlap = iou(fixed.rects, good.rects);
    console.log(`R0 job: repaired highlight overlap with the glyphs measured by the reader: ${(overlap * 100).toFixed(1)}%`);
    expect(overlap).toBeGreaterThanOrEqual(0.9);
    expect(after.find((x) => x.id === good.id)!.rects).toEqual(good.rects);
    // Not placeable: untouched, still without geom, for the reader's "To check" group.
    for (const x of [noText, lost]) {
      const now = after.find((y) => y.id === x.id)!;
      expect(now.geom).toBeUndefined();
      expect(now.rects).toEqual(stretched);
    }
    await a.verifyLibraryUntouched(); // the PDF files were only read

    // Undoing a repair restores the old rectangles AND clears geom (it is the gate for writing into the PDF).
    const undone = await ipcData<{ annotation: Ann }>(b.window, 'annotations:save', { docId, annotation: { id: fixed.id, kind: 'highlight', page: 1, rects: stretched, text: fixed.text, color: 'blue', geom: null } });
    expect(undone.annotation.geom).toBeUndefined();
    expect((await list()).find((x) => x.id === fixed.id)!.geom).toBeUndefined();
  });
});
