import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeSyntheticPdf } from '@rl/testkit';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { ipcData, waitForScan } from './helpers/phase1';

/**
 * Design audit tour (not a regression test). Skipped unless RL_DESIGN_AUDIT=1. After `npm run build`:
 *   RL_DESIGN_AUDIT=1 npx playwright test -c e2e/playwright.config.ts design-audit
 * It walks every view, panel and dialog it can reach on synthetic libraries (Italian and English UI), with the mock AI
 * provider and no network, in light and dark theme and at three window sizes. For each screen it saves a PNG in
 * `audit-shots/` (git-ignored) and records clicks from the library, visible controls, console errors, clipped or
 * off-screen elements, WCAG contrast failures and (for a few screens) the Tab focus order, in `audit-shots/*.json`.
 * Every step is best effort: a failure is recorded and the tour goes on.
 */
const ENABLED = process.env.RL_DESIGN_AUDIT === '1';
// RL_DESIGN_AUDIT_OUT: a sub-folder of audit-shots/ for this run (file names repeat between runs).
const OUT = path.resolve(import.meta.dirname, '../audit-shots', process.env.RL_DESIGN_AUDIT_OUT ?? '');

test.use({ actionTimeout: 8_000 });
test.describe.configure({ mode: 'serial' });

type Theme = 'light' | 'dark';
interface ShotRecord {
  file: string;
  screen: string;
  clicks: number;
  theme: Theme;
  size: string;
  controls: number;
  consoleErrors: string[];
  clipped: string[];
  offscreen: string[];
  contrastFails: { text: string; ratio: number; fg: string; bg: string; sel: string }[];
  minContrast: number | null;
  focusOrder?: { el: string; visibleFocus: boolean }[];
  note?: string;
}

class Audit {
  readonly records: ShotRecord[] = [];
  readonly failures: { step: string; error: string }[] = [];
  readonly facts: Record<string, unknown> = {};
  private consoleBuf: string[] = [];
  private seq = 0;
  theme: Theme = 'light';
  size = '1280x800';

  constructor(
    readonly run: string,
    readonly ctx: LaunchedApp,
  ) {
    const w = ctx.window;
    // Electron pages do not take the `use` options of the config: a missing control fails a step in 8 s, not 30.
    w.setDefaultTimeout(8_000);
    w.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') this.consoleBuf.push(`${m.type()}: ${m.text().slice(0, 300)}`);
    });
    w.on('pageerror', (e) => this.consoleBuf.push(`pageerror: ${String(e).slice(0, 300)}`));
  }

  get page(): Page {
    return this.ctx.window;
  }

  async step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).split('\n')[0]!.slice(0, 400);
      this.failures.push({ step: name, error: msg });
      console.log(`[audit:${this.run}] step failed: ${name}: ${msg}`);
      // Leave transient UI (dialogs, menus) behind so the next step starts clean. Esc only reaches a dialog that holds
      // the focus: when the focus was lost, close it with its own close button.
      await this.page.keyboard.press('Escape').catch(() => {});
      for (let i = 0; i < 3; i++) {
        const close = this.page.locator('.rl-dialog .dialog-head button.icon-button').last();
        if (!(await close.isVisible().catch(() => false))) break;
        this.facts[`dialog-left-open-after-${name}`] = true;
        await close.click({ timeout: 2_000 }).catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }
  }

  async setSize(w: number, h: number): Promise<void> {
    // On a scaled display the off-screen window does not always get the content size asked for: correct and retry.
    let ask = [w, h];
    let got = '';
    for (let i = 0; i < 4; i++) {
      await this.ctx.app.evaluate(({ BrowserWindow }, [cw, ch]) => {
        const win = BrowserWindow.getAllWindows()[0]!;
        win.setContentSize(cw as number, ch as number);
      }, ask);
      await this.page.waitForTimeout(400);
      const [iw, ih] = await this.page.evaluate(() => [window.innerWidth, window.innerHeight]);
      got = `${iw}x${ih}`;
      if (iw === w && ih === h) break;
      ask = [ask[0]! + (w - iw!), ask[1]! + (h - ih!)];
    }
    if (got !== `${w}x${h}`) this.failures.push({ step: `setSize ${w}x${h}`, error: `got ${got}` });
    this.size = `${w}x${h}`;
    await this.page.waitForTimeout(250);
  }

  async setTheme(theme: Theme): Promise<void> {
    await this.page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.style.colorScheme = t;
      window.dispatchEvent(new Event('rl:theme'));
    }, theme);
    this.theme = theme;
    await this.page.waitForTimeout(150);
  }

  /** Screenshot plus measurements of the current window. */
  async shot(screen: string, clicks: number, opts: { focus?: number; note?: string; target?: Locator; fullScale?: boolean } = {}): Promise<ShotRecord | undefined> {
    const file = `${this.run}-${String(++this.seq).padStart(3, '0')}-${screen}-${this.theme}-${this.size}.png`;
    try {
      await this.page.waitForTimeout(200);
      if (opts.target) await opts.target.screenshot({ path: path.join(OUT, file), scale: 'css', animations: 'disabled' });
      else await this.page.screenshot({ path: path.join(OUT, file), scale: opts.fullScale ? 'device' : 'css', animations: 'disabled' });
      const m = await this.page.evaluate(measure);
      const rec: ShotRecord = {
        file,
        screen,
        clicks,
        theme: this.theme,
        size: this.size,
        controls: m.controls,
        consoleErrors: this.consoleBuf.splice(0),
        clipped: m.clipped,
        offscreen: m.offscreen,
        contrastFails: m.contrastFails,
        minContrast: m.minContrast,
        ...(opts.note ? { note: opts.note } : {}),
      };
      if (opts.focus) rec.focusOrder = await this.focusWalk(opts.focus);
      this.records.push(rec);
      this.flush();
      return rec;
    } catch (e) {
      this.failures.push({ step: `shot ${screen}`, error: String((e as Error)?.message ?? e).slice(0, 300) });
      return undefined;
    }
  }

  async focusWalk(n: number): Promise<{ el: string; visibleFocus: boolean }[]> {
    const p = this.page;
    await p.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      document.body.focus();
    });
    const out: { el: string; visibleFocus: boolean }[] = [];
    for (let i = 0; i < n; i++) {
      await p.keyboard.press('Tab');
      out.push(
        await p.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return { el: '(body)', visibleFocus: false };
          const s = getComputedStyle(el);
          const visibleFocus = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== '');
          const label = (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 40);
          const tid = el.getAttribute('data-testid');
          return { el: `${el.tagName.toLowerCase()}${tid ? `[${tid}]` : ''} "${label}"`, visibleFocus };
        }),
      );
    }
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    return out;
  }

  flush(): void {
    writeFileSync(path.join(OUT, `metrics-${this.run}.json`), JSON.stringify({ run: this.run, records: this.records, failures: this.failures, facts: this.facts }, null, 1));
  }
}

/** Runs in the page: visible controls, clipped/off-screen elements, WCAG contrast of visible text. */
function measure() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  };
  const desc = (el: Element) => {
    const tid = el.getAttribute('data-testid');
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${tid ? `[${tid}]` : ''}${cls ? `.${cls}` : ''} "${txt}"`;
  };
  const controls = [...document.querySelectorAll('button, input, select, textarea, a[href], [role=button], [role=tab], [role=checkbox], [role=radio], [role=menuitem], [role=option]')].filter(visible).length;

  const clipped: string[] = [];
  const offscreen: string[] = [];
  const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('.textLayer, .pdfViewer canvas, svg, .annotationLayer'));
  for (const el of all) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const h = el as HTMLElement;
    if (h.clientWidth > 0 && h.scrollWidth > h.clientWidth + 2 && (s.overflowX === 'hidden' || s.overflowX === 'clip') && (h.textContent || '').trim()) {
      clipped.push(`${desc(el)}${s.textOverflow === 'ellipsis' ? ' [ellipsis]' : ''} (${h.scrollWidth}>${h.clientWidth})`);
    }
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && s.position !== 'fixed' && !el.closest('.pdfViewer')) offscreen.push(`${desc(el)} right=${Math.round(r.right)}`);
  }

  const parse = (c: string): [number, number, number, number] | null => {
    let m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
    }
    m = c.match(/^color\(srgb ([^)]+)\)$/);
    if (m) {
      const p = m[1]!.split(/[\s/]+/).filter(Boolean).map(Number);
      return [p[0]! * 255, p[1]! * 255, p[2]! * 255, p[3] ?? 1];
    }
    return null;
  };
  const blend = (top: number[], bottom: number[]) => {
    const a = top[3]!;
    return [top[0]! * a + bottom[0]! * (1 - a), top[1]! * a + bottom[1]! * (1 - a), top[2]! * a + bottom[2]! * (1 - a), 1];
  };
  const bgOf = (el: Element): number[] => {
    const layers: number[][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let base = [255, 255, 255, 1];
    const rootBg = parse(getComputedStyle(document.body).backgroundColor);
    if (rootBg && rootBg[3] >= 1) base = rootBg;
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i]!, base);
    return base;
  };
  const lum = (c: number[]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
  };
  const contrastFails: { text: string; ratio: number; fg: string; bg: string; sel: string }[] = [];
  let minContrast: number | null = null;
  const seen = new Set<string>();
  for (const el of all) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 1);
    if (!own || !visible(el)) continue;
    if ((el as HTMLButtonElement).disabled || el.closest('[disabled], [aria-disabled=true]')) continue;
    const s = getComputedStyle(el);
    const fgRaw = parse(s.color);
    if (!fgRaw) continue;
    const bg = bgOf(el);
    const fg = fgRaw[3] < 1 ? blend(fgRaw, bg) : fgRaw;
    let opacity = 1;
    for (let e: Element | null = el; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
    const fgEff = opacity < 1 ? blend([...fg.slice(0, 3), opacity], bg) : fg;
    const l1 = lum(fgEff);
    const l2 = lum(bg);
    const ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    minContrast = minContrast === null ? ratio : Math.min(minContrast, ratio);
    if (ratio < (large ? 3 : 4.5)) {
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
      const key = `${text}|${ratio}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rgb = (c: number[]) => `rgb(${c.slice(0, 3).map((v) => Math.round(v)).join(',')})`;
      contrastFails.push({ text, ratio, fg: rgb(fgEff), bg: rgb(bg), sel: desc(el).slice(0, 80) });
    }
  }
  return { controls, clipped: clipped.slice(0, 40), offscreen: offscreen.slice(0, 40), contrastFails: contrastFails.slice(0, 40), minContrast };
}

/** Geometry of the first rendered PDF page: page box, canvas bitmap, canvas CSS box, text layer, pdf.js variables. */
function readerGeometry() {
  const area = document.querySelector('[data-testid="reader-pages-area"]');
  const pg = area?.querySelector<HTMLElement>('.page[data-page-number="1"]');
  if (!pg) return null;
  const box = (el: Element | null | undefined) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  };
  const cs = getComputedStyle(pg);
  const canvas = pg.querySelector('canvas');
  const ccs = canvas ? getComputedStyle(canvas) : null;
  const rules: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of [...list]) {
      if (r instanceof CSSStyleRule && pg.matches(r.selectorText) && /(^|[\s,])\.page(\s*[,{]|$)/.test(r.selectorText + '{')) rules.push(`${r.selectorText} { ${r.style.cssText} }  [${(sheet.href || 'inline').split('/').pop()}]`);
    }
  }
  return {
    dpr: window.devicePixelRatio,
    area: box(area),
    page: box(pg),
    pagePadding: cs.padding,
    pageMaxWidth: cs.maxWidth,
    pageBoxSizing: cs.boxSizing,
    pageInlineStyle: pg.getAttribute('style'),
    pageClasses: pg.className,
    canvasWrapper: box(pg.querySelector('.canvasWrapper')),
    canvasBitmap: canvas ? { w: canvas.width, h: canvas.height } : null,
    canvasCss: box(canvas),
    canvasStyle: ccs ? { width: ccs.width, height: ccs.height } : null,
    textLayer: box(pg.querySelector('.textLayer')),
    annotLayer: box(pg.querySelector('.rl-annot-layer')),
    pageRulesFromAppCss: rules,
    zoomLabel: document.querySelector('[data-testid="reader-zoom"]')?.textContent ?? null,
  };
}

/** Computed style of the app sidebar and of the open dialog (pdf.js' own `.sidebar` / `.dialog` rules leak into them). */
function styleProbe() {
  const pick = (el: Element | null) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), borderRadius: s.borderRadius, boxShadow: s.boxShadow.slice(0, 80), padding: s.padding, border: s.border.slice(0, 60), background: s.backgroundColor, inset: `${s.top} ${s.left}`, position: s.position, margin: s.margin };
  };
  return { sidebar: pick(document.querySelector('.app-sidebar')), dialog: pick(document.querySelector('.rl-dialog')) };
}

/** Rules of the lazily loaded reader stylesheet (pdf.js' pdf_viewer.css) that hit app elements outside the PDF area,
 * plus the class names the two stylesheets share. */
function leakedRules() {
  const isReaderSheet = (sh: CSSStyleSheet) => {
    try {
      return [...sh.cssRules].some((r) => r instanceof CSSStyleRule && r.selectorText.includes('.pdfViewer'));
    } catch {
      return false;
    }
  };
  const flat = (list: CSSRuleList): CSSStyleRule[] => {
    const out: CSSStyleRule[] = [];
    for (const r of [...list]) {
      if (r instanceof CSSStyleRule) out.push(r);
      else if ('cssRules' in r) out.push(...flat((r as CSSGroupingRule).cssRules));
    }
    return out;
  };
  const sheets = [...document.styleSheets];
  const reader = sheets.filter(isReaderSheet);
  const others = sheets.filter((sh) => !reader.includes(sh));
  const classes = (rules: CSSStyleRule[]) => new Set(rules.flatMap((r) => r.selectorText.match(/\.[a-zA-Z][\w-]*/g) ?? []));
  const readerRules = reader.flatMap((sh) => flat(sh.cssRules));
  let appRules: CSSStyleRule[] = [];
  for (const sh of others) {
    try {
      appRules = appRules.concat(flat(sh.cssRules));
    } catch {
      /* cross-origin */
    }
  }
  const appClasses = classes(appRules);
  const shared = [...classes(readerRules)].filter((c) => appClasses.has(c)).sort();
  const area = document.querySelector('[data-testid="reader-pages-area"]');
  const hits: { selector: string; count: number; sample: string; css: string }[] = [];
  for (const r of readerRules) {
    let els: Element[] = [];
    try {
      els = [...document.querySelectorAll(r.selectorText)].filter((e) => !area?.contains(e) && !e.closest('.pdfViewer'));
    } catch {
      continue;
    }
    if (els.length === 0 || r.selectorText === ':root' || /^\*|^html|^body/.test(r.selectorText)) continue;
    const e = els[0]!;
    hits.push({ selector: r.selectorText.slice(0, 80), count: els.length, sample: `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 40)}`, css: r.style.cssText.slice(0, 160) });
  }
  return { readerSheets: reader.length, readerRules: readerRules.length, sharedClassNames: shared, rulesHittingAppNow: hits.slice(0, 40) };
}

async function visibleNow(l: Locator): Promise<boolean> {
  return l.first().isVisible().catch(() => false);
}

/** First-run wizard, screenshot of every step. */
async function wizard(a: Audit, lang: 'it' | 'en', name: string): Promise<number> {
  const w = a.page;
  await expect(w.getByTestId('wizard')).toBeVisible({ timeout: 30_000 });
  let clicks = 0;
  for (let i = 0; i < 12; i++) {
    const title = ((await w.getByTestId('wizard-step-title').textContent().catch(() => '')) ?? '').trim().slice(0, 30).replace(/[^\p{L}\p{N}]+/gu, '_');
    await a.shot(`wizard-step${i + 1}-${title}`, clicks, i === 0 ? { focus: 12 } : {});
    if (await visibleNow(w.getByTestId('wizard-ui-language'))) {
      await w.getByTestId('wizard-ui-language').selectOption(lang);
      clicks++;
    }
    if ((await visibleNow(w.getByTestId('wizard-choose-folder'))) && !(await visibleNow(w.getByTestId('wizard-folder-chosen')))) {
      await w.getByTestId('wizard-choose-folder').click();
      clicks++;
      await expect(w.getByTestId('wizard-folder-chosen')).toBeVisible();
      await a.shot(`wizard-step${i + 1}-folder-chosen`, clicks);
    }
    if (await visibleNow(w.getByTestId('wizard-lib-name'))) {
      await w.getByTestId('wizard-lib-name').fill(name);
      clicks++;
    }
    if (await visibleNow(w.getByTestId('wizard-ai-confirm'))) {
      await w.getByTestId('wizard-ai-confirm').check();
      clicks++;
    }
    if (await visibleNow(w.getByTestId('wizard-create'))) {
      await w.getByTestId('wizard-create').click();
      clicks++;
      break;
    }
    await w.getByTestId('wizard-next').click();
    clicks++;
  }
  await expect(w.getByTestId('wizard')).toHaveCount(0, { timeout: 30_000 });
  return clicks;
}

async function nav(a: Audit, id: string): Promise<void> {
  await a.page.getByTestId(`nav-${id}`).click();
  await a.page.waitForTimeout(400);
}

/** The settings page: one shot per section card, plus the whole page length. */
async function settingsTour(a: Audit, prefix: string): Promise<void> {
  const w = a.page;
  await nav(a, 'settings');
  await expect(w.getByTestId('settings-page')).toBeVisible();
  await w.waitForTimeout(800);
  const len = await w.evaluate(() => {
    const m = document.querySelector('main')!;
    const sections = [...document.querySelectorAll('[data-testid="settings-page"] > *')].map((e) => ({
      tag: e.tagName.toLowerCase(),
      head: (e.querySelector('h2, h3, legend')?.textContent ?? e.textContent ?? '').trim().slice(0, 60),
      h: Math.round(e.getBoundingClientRect().height),
      controls: e.querySelectorAll('button, input, select, textarea').length,
    }));
    return { scrollHeight: m.scrollHeight, clientHeight: m.clientHeight, sections, totalControls: document.querySelectorAll('[data-testid="settings-page"] :is(button,input,select,textarea)').length };
  });
  a.facts[`${prefix}-settings-length`] = len;
  await a.shot(`${prefix}-settings-top`, 1, { focus: 25 });
  // One shot per screenful of the single long page (element shots of cards taller than the window are unreliable).
  for (let y = 0, i = 1; y < len.scrollHeight && i <= 20; y += len.clientHeight - 60, i++) {
    await w.evaluate((top) => document.querySelector('main')?.scrollTo(0, top), y);
    await w.waitForTimeout(150);
    await a.shot(`${prefix}-settings-scroll${String(i).padStart(2, '0')}`, 1);
  }
  await w.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));
}

async function libraryTour(a: Audit, ctx: LaunchedApp, lang: 'it' | 'en'): Promise<void> {
  const w = a.page;
  const files = ctx.library!.manifest!.files;
  const pdf = files.find((f) => f.format === 'pdf' && f.title && f.hasText !== false)!;
  const rowsL = w.getByTestId('search-result');

  await a.step('library home', async () => {
    await nav(a, 'library');
    await a.shot('library-home', 0, { focus: 25 });
  });
  await a.step('library grid', async () => {
    await w.getByTestId('view-grid').click();
    await w.waitForTimeout(1500);
    await a.shot('library-grid', 1);
    await w.getByTestId('view-list').click();
  });
  await a.step('library row hover', async () => {
    await rowsL.first().hover();
    await a.shot('library-row-hover', 0);
  });
  await a.step('library select one', async () => {
    await rowsL.first().click();
    await w.waitForTimeout(500);
    await a.shot('library-one-click-selected', 1, { note: 'a single click only selects: no detail pane' });
    // A second click on the selected row: does it open the card? (Recorded, not assumed.) Wait past the double-click time.
    await w.waitForTimeout(700);
    await rowsL.first().click();
    await w.waitForTimeout(600);
    a.facts['detail-opens-on-second-click'] = await visibleNow(w.getByTestId('detail-pane'));
    // The discoverable way: the "Details" button of the selection bar (Enter on the focused row does the same).
    if (!(await visibleNow(w.getByTestId('detail-pane')))) await w.getByTestId('selection-details').click();
    await expect(w.getByTestId('detail-pane')).toBeVisible();
    await w.waitForTimeout(800);
    a.facts['detail-pane-geometry'] = await w.getByTestId('detail-pane').evaluate((e) => ({ w: Math.round(e.getBoundingClientRect().width), scrollH: e.scrollHeight, clientH: e.clientHeight, sections: [...e.querySelectorAll('h2, h3')].map((h) => (h.textContent || '').trim().slice(0, 40)) }));
    await a.shot('library-detail', 2, { focus: 15 });
    await w.getByTestId('detail-pane').evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await w.waitForTimeout(300);
    await a.shot('library-detail-bottom', 2);
  });
  await a.step('detail similar', async () => {
    const t = w.getByTestId('detail-pane').getByTestId('similar-toggle');
    await t.scrollIntoViewIfNeeded();
    await t.click();
    await w.waitForTimeout(2500);
    await w.getByTestId('detail-pane').getByTestId('doc-similar').scrollIntoViewIfNeeded().catch(() => {});
    await a.shot('library-detail-similar', 3);
  });
  await a.step('detail citations', async () => {
    const t = w.getByTestId('detail-pane').getByTestId('citations-toggle');
    await t.scrollIntoViewIfNeeded();
    await t.click();
    await w.waitForTimeout(2500);
    await w.getByTestId('detail-pane').getByTestId('doc-citations').scrollIntoViewIfNeeded().catch(() => {});
    await a.shot('library-detail-citations', 3);
    if (await visibleNow(w.getByTestId('citations-refresh'))) {
      await w.getByTestId('citations-refresh').click().catch(() => {});
      await w.waitForTimeout(2500);
      await a.shot('library-detail-citations-refresh-offline', 4);
    }
  });
  await a.step('library multi select', async () => {
    await rowsL.first().click();
    await w.getByTestId('search-results').press('Control+a');
    await expect(w.getByTestId('selection-bar')).toBeVisible();
    await a.shot('library-selection-bar', 2);
  });
  await a.step('add to project popover', async () => {
    await w.getByTestId('add-to-project-button').click();
    await w.waitForTimeout(300);
    await a.shot('library-add-to-project', 3);
    await w.keyboard.press('Escape');
  });
  await a.step('bulk AI without folders', async () => {
    await w.getByTestId('bulk-ai-propose').click();
    await w.waitForTimeout(1500);
    await a.shot('library-bulk-ai-no-folders', 3);
    await w.keyboard.press('Escape');
  });
  await a.step('bulk export', async () => {
    await w.getByTestId('bulk-export').click();
    const dialog = w.getByTestId('export-dialog');
    await expect(dialog).toBeVisible();
    await w.waitForTimeout(1200);
    await a.shot('export-dialog-from-selection', 3);
    a.facts['export-dialog-geometry'] = await dialog.evaluate((e) => ({ scrollH: e.scrollHeight, clientH: e.clientHeight, controls: e.querySelectorAll('button, input, select, textarea').length }));
    // Full flow: destination (test hook: a folder outside the library), folder name, run, confirm, result.
    await dialog.getByTestId('export-choose').click();
    await expect(dialog.getByTestId('export-dest-path')).toBeVisible();
    await dialog.getByTestId('export-folder-name').fill(lang === 'it' ? 'secondo-cervello' : 'second-brain');
    await expect(dialog.getByTestId('export-target-note')).toHaveAttribute('data-state', /.+/, { timeout: 30_000 });
    await w.waitForTimeout(600);
    await a.shot('export-dialog-destination-chosen', 6);
    await dialog.getByTestId('export-run').scrollIntoViewIfNeeded();
    await a.shot('export-dialog-run-button', 6);
    await dialog.getByTestId('export-run').click();
    await w.waitForTimeout(300);
    a.facts['export-focus-after-run'] = await w.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName.toLowerCase()} ${e.getAttribute('data-testid') ?? ''} inDialog=${!!e.closest('.dialog')}` : null; });
    // Documents outside the AI-enabled folders: the dialog asks for a confirmation inline, below the fold.
    await dialog.getByTestId('export-confirm-yes').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if (await visibleNow(dialog.getByTestId('export-confirm-yes'))) {
      await dialog.getByTestId('export-confirm-yes').scrollIntoViewIfNeeded();
      await a.shot('export-confirm', 7);
      await dialog.getByTestId('export-confirm-yes').click();
    }
    await w.waitForTimeout(800);
    await a.shot('export-running', 8);
    await expect(dialog.getByTestId('export-result')).toHaveAttribute('data-state', /done|failed/, { timeout: 120_000 });
    await w.waitForTimeout(500);
    await a.shot('export-result', 8);
    await dialog.getByTestId('export-close').click().catch(() => w.keyboard.press('Escape'));
  });
  await a.step('bulk citations', async () => {
    await w.getByTestId('bulk-citations').click();
    await w.waitForTimeout(1500);
    await a.shot('library-bulk-citations', 3);
    await w.keyboard.press('Escape');
    await w.getByTestId('selection-clear').click().catch(() => {});
  });
  await a.step('search typed', async () => {
    const word = lang === 'it' ? 'analisi' : 'learning';
    await w.getByTestId('search-input').fill(word);
    await w.waitForTimeout(1200);
    await a.shot('library-search-results', 1);
    await w.getByTestId('search-input').fill('zzqqxx');
    await w.waitForTimeout(1000);
    await a.shot('library-search-empty', 1);
    await w.getByTestId('search-input').fill('');
  });
  await a.step('tags tab', async () => {
    await w.getByTestId('tab-tags').click();
    await a.shot('library-tags-tab-empty', 1);
  });
  await a.step('filters tab', async () => {
    await w.getByTestId('tab-filters').click();
    await a.shot('library-filters-tab', 1);
    await w.getByTestId('tab-folders').click();
  });
  await a.step('advanced search dialog', async () => {
    await w.getByTestId('adv-search').click();
    await w.waitForTimeout(800);
    await a.shot('advanced-search-dialog', 1);
    await w.keyboard.press('Escape');
  });
  await a.step('taxonomy manager', async () => {
    await w.getByTestId('open-taxonomy').click();
    await expect(w.getByTestId('taxonomy-manager')).toBeVisible();
    await a.shot('taxonomy-empty', 1);
    await w.getByTestId('new-top-level').click();
    await a.shot('taxonomy-new-form', 2);
    await w.getByTestId('new-node-label').fill(lang === 'it' ? 'Metodi' : 'Methods');
    await w.waitForTimeout(300);
    a.facts[`taxonomy-create-enabled-${lang}`] = await w.getByTestId('new-node-create').isEnabled();
    await w.getByTestId('new-node-create').click();
    await w.getByTestId('new-top-level').click();
    await w.getByTestId('new-node-label').fill(lang === 'it' ? 'Risultati' : 'Results');
    await w.getByTestId('new-node-create').click();
    await w.waitForTimeout(400);
    await a.shot('taxonomy-node-editor', 6);
    await w.getByTestId('taxonomy-back').click();
  });
  await a.step('tag a document', async () => {
    await rowsL.first().click();
    await w.waitForTimeout(400);
    if (!(await visibleNow(w.getByTestId('detail-pane')))) await rowsL.first().click();
    const input = w.getByTestId('detail-pane').getByTestId('tag-input').first();
    await input.fill(lang === 'it' ? 'Met' : 'Met');
    await w.waitForTimeout(500);
    await a.shot('library-tag-picker', 3);
    await input.press('Enter');
    await w.waitForTimeout(400);
    await a.shot('library-detail-tagged', 3);
  });
  await a.step('history panel', async () => {
    await w.getByTestId('history-toggle').click();
    await w.waitForTimeout(400);
    await a.shot('history-panel', 1);
    await w.keyboard.press('Escape');
    await w.waitForTimeout(300);
    a.facts['history-panel-closes-on-escape'] = !(await visibleNow(w.getByTestId('history-panel')));
    if (await visibleNow(w.getByTestId('history-panel'))) await w.getByTestId('history-toggle').click();
  });
  await a.step('palette', async () => {
    await w.keyboard.press('Control+k');
    await w.waitForTimeout(800);
    if (!(await visibleNow(w.getByTestId('palette-input')))) {
      await w.getByTestId('chat-toggle').click();
      await w.getByTestId('palette-open').click();
    }
    await expect(w.getByTestId('palette-input')).toBeVisible();
    await a.shot('palette', 1);
    await w.getByTestId('palette-input').fill(lang === 'it' ? 'esporta' : 'export');
    await a.shot('palette-filtered', 1);
    await w.keyboard.press('Escape');
  });
  await a.step('guide F1', async () => {
    a.facts['styles-before-reader-sidebar'] = await w.evaluate(styleProbe);
    await w.keyboard.press('F1');
    await w.waitForTimeout(800);
    a.facts['styles-before-reader-dialog'] = await w.evaluate(styleProbe);
    await a.shot('guide-dialog', 1);
    await w.keyboard.press('Escape');
  });
  await a.step('shortcuts list', async () => {
    await w.keyboard.press('Control+/');
    await w.waitForTimeout(800);
    await a.shot('shortcuts-list', 1);
    await w.keyboard.press('Escape');
  });
  await a.step('chat panel', async () => {
    const toggle = w.getByTestId('chat-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await w.waitForTimeout(1000);
    await a.shot('chat-open-no-folders', 1);
  });

  await a.step('reader', async () => {
    await readerTour(a, ctx, pdf.title!, pdf.relPath);
  });
  await a.step('pdf.js CSS leak after the reader', async () => {
    if (await visibleNow(w.getByTestId('reader'))) await w.getByTestId('reader-close').click();
    await nav(a, 'library');
    a.facts['styles-after-reader-sidebar'] = await w.evaluate(styleProbe);
    await a.shot('library-after-reader', 1);
    await w.keyboard.press('F1');
    await w.waitForTimeout(800);
    a.facts['styles-after-reader-dialog'] = await w.evaluate(styleProbe);
    await a.shot('guide-dialog-after-reader', 1);
    await w.keyboard.press('Escape');
  });
}

async function readerTour(a: Audit, ctx: LaunchedApp, title: string, relPath: string): Promise<void> {
  const w = a.page;
  // A failed taxonomy step can leave the library in taxonomy mode: back to the list first.
  if (await visibleNow(w.getByTestId('taxonomy-back'))) await w.getByTestId('taxonomy-back').click();
  const toggle = w.getByTestId('chat-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  await w.getByTestId('search-sort').selectOption('title').catch(() => {});
  const row = w.getByTestId('search-result').filter({ hasText: title }).first();
  await row.hover();
  await row.getByTestId('row-read').click();
  await expect(w.getByTestId('reader')).toBeVisible();
  await expect(w.locator('[data-testid="reader-pages-area"] .page[data-page-number="1"] canvas')).toBeVisible({ timeout: 60_000 });
  await w.waitForTimeout(1500);
  const bytes = readFileSync(path.join(ctx.library!.root, relPath)).toString('latin1');
  const mb = bytes.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  const media = mb ? { w: Number(mb[3]) - Number(mb[1]), h: Number(mb[4]) - Number(mb[2]) } : null;
  a.facts[`reader-mediabox-${relPath}`] = media;
  const geo = async (label: string) => {
    const g = await w.evaluate(readerGeometry);
    a.facts[`reader-geometry-${label}-${a.size}`] = { media, ...g };
  };
  await geo('fit');
  a.facts['pdfjs-css-rules-outside-reader'] = await w.evaluate(leakedRules);
  await a.shot('reader-open-fit', 2, { focus: 20 });
  await a.shot('reader-open-fit-device', 2, { fullScale: true });
  await w.getByTestId('reader-zoom-in').click();
  await w.waitForTimeout(1200);
  await geo('zoomin');
  await a.shot('reader-zoom-in', 3);
  await w.getByTestId('reader-zoom-out').click();
  await w.getByTestId('reader-zoom-out').click();
  await w.getByTestId('reader-zoom-out').click();
  await w.waitForTimeout(1200);
  await geo('zoomout');
  await a.shot('reader-zoom-out', 6);
  await w.getByTestId('reader-fit').click();
  await w.waitForTimeout(800);

  // Select a line the way a drag would, see what the user gets.
  await a.step('reader select text', async () => {
    const ok = await w.evaluate(() => {
      const spans = [...document.querySelectorAll('[data-testid="reader-pages-area"] .page[data-page-number="1"] .textLayer span')].filter((s) => (s.textContent || '').trim().length > 20);
      const el = spans[1] ?? spans[0];
      if (!el) return false;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    });
    a.facts['reader-select-ok'] = ok;
    await expect(w.getByTestId('annotation-bar')).toBeVisible({ timeout: 10_000 });
    await a.shot('reader-selection-bar', 3);
    await w.getByTestId('ann-highlight').click();
    await w.waitForTimeout(800);
    await a.shot('reader-after-highlight', 4);
    const align = await w.evaluate(() => {
      const mark = document.querySelector('[data-testid="annotation-mark"]');
      const pg = document.querySelector('[data-testid="reader-pages-area"] .page[data-page-number="1"]');
      const canvas = pg?.querySelector('canvas');
      const tl = pg?.querySelector('.textLayer');
      const r = (e: Element | null | undefined) => (e ? e.getBoundingClientRect() : null);
      const m = r(mark);
      const c = r(canvas);
      const t = r(tl);
      return m && c && t ? { mark: { x: m.x, y: m.y, w: m.width, h: m.height }, canvasOffset: { dx: c.x - t.x, dy: c.y - t.y }, canvasScale: { sx: c.width / t.width, sy: c.height / t.height } } : null;
    });
    a.facts['reader-highlight-alignment'] = align;
    await w.getByTestId('ann-close').click().catch(() => w.keyboard.press('Escape'));
  });
  await a.step('reader underline', async () => {
    await w.evaluate(() => {
      const spans = [...document.querySelectorAll('[data-testid="reader-pages-area"] .page[data-page-number="1"] .textLayer span')].filter((s) => (s.textContent || '').trim().length > 20);
      const el = spans[3] ?? spans[spans.length - 1];
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await expect(w.getByTestId('annotation-bar')).toBeVisible({ timeout: 10_000 });
    await w.getByTestId('ann-color-blue').check({ force: true }).catch(() => {});
    await w.getByTestId('ann-underline').click();
    await w.waitForTimeout(800);
    await a.shot('reader-after-underline', 5);
    await w.keyboard.press('Escape');
  });
  await a.step('reader click annotation', async () => {
    const mark = w.getByTestId('annotation-mark').first();
    const box = await mark.boundingBox();
    if (box) await w.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await w.waitForTimeout(500);
    await a.shot('reader-annotation-edit-bar', 1);
    await w.keyboard.press('Escape');
  });
  await a.step('reader find', async () => {
    await w.getByTestId('reader-find-toggle').click();
    const word = await w.evaluate(() => (document.querySelector('[data-testid="reader-pages-area"] .textLayer span')?.textContent || 'the').trim().split(/\s+/)[0] ?? 'the');
    await w.getByTestId('reader-find-input').fill(word);
    await w.getByTestId('reader-find-input').press('Enter');
    await w.waitForTimeout(800);
    await a.shot('reader-find', 2);
    await w.getByTestId('reader-find-close').click();
  });
  await a.step('reader side panel tabs', async () => {
    if (!(await visibleNow(w.getByTestId('reader-side')))) await w.getByTestId('reader-side-toggle').click();
    for (const tab of ['annotations', 'pageNote', 'fileNote', 'notes']) {
      await w.getByTestId(`reader-tab-${tab}`).click();
      if (tab === 'pageNote') await w.getByTestId('note-page-input').fill('Nota di prova sulla pagina').catch(() => {});
      await w.waitForTimeout(400);
      await a.shot(`reader-side-${tab}`, 2);
    }
  });
  await a.step('reader study state', async () => {
    await w.getByTestId('reader-study-reading').check({ force: true });
    await a.shot('reader-study-state', 1);
  });
  await a.step('reader geometry at other sizes', async () => {
    for (const [cw, ch] of [
      [1920, 1080],
      [1024, 700],
    ] as const) {
      await a.setSize(cw, ch);
      await w.waitForTimeout(1500);
      await geo('fit');
      await a.shot('reader-open-fit', 2);
      if (cw === 1920) {
        await w.getByTestId('reader-page-input').fill('1');
        await w.getByTestId('reader-page-input').press('Enter');
        await w.waitForTimeout(1200);
        const sel = await w.evaluate(() => {
          const spans = [...document.querySelectorAll('[data-testid="reader-pages-area"] .page[data-page-number="1"] .textLayer span')].filter((s) => (s.textContent || '').trim().length > 20);
          const el = spans[2] ?? spans[0];
          if (!el) return null;
          const range = document.createRange();
          range.selectNodeContents(el);
          const s = document.getSelection()!;
          s.removeAllRanges();
          s.addRange(range);
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          const r = range.getBoundingClientRect();
          return { text: (el.textContent || '').slice(0, 40), x: r.x, y: r.y, w: r.width, h: r.height };
        });
        await w.waitForTimeout(500);
        await a.shot('reader-1920-selection', 3, { fullScale: true });
        if (await visibleNow(w.getByTestId('ann-highlight'))) {
          const before = await w.getByTestId('annotation-mark').count();
          await w.getByTestId('ann-highlight').click();
          await w.waitForTimeout(800);
          // Where the glyphs are really drawn: the canvas is squeezed into the page box, so a text-layer x maps to
          // canvas.x + (x - textLayer.x) * canvas.w / textLayer.w. The highlight follows the text layer.
          const m = await w.evaluate((n) => {
            const mk = document.querySelectorAll('[data-testid="annotation-mark"]')[n];
            const pg = document.querySelector('[data-testid="reader-pages-area"] .page[data-page-number="1"]');
            const c = pg?.querySelector('canvas')?.getBoundingClientRect();
            const t = pg?.querySelector('.textLayer')?.getBoundingClientRect();
            if (!mk || !c || !t) return null;
            const r = mk.getBoundingClientRect();
            const sx = c.width / t.width;
            const glyphX = c.x + (r.x - t.x) * sx;
            const glyphW = r.width * sx;
            return {
              mark: { x: r.x, y: r.y, w: r.width, h: r.height },
              canvas: { x: c.x, w: c.width, h: c.height },
              textLayer: { x: t.x, w: t.width, h: t.height },
              scaleX: Math.round(sx * 1000) / 1000,
              glyphsDrawnAt: { x: Math.round(glyphX), w: Math.round(glyphW) },
              offsetLeftPx: Math.round(r.x - glyphX),
              offsetRightPx: Math.round(r.x + r.width - (glyphX + glyphW)),
              overlapRatio: Math.round((Math.max(0, Math.min(r.x + r.width, glyphX + glyphW) - Math.max(r.x, glyphX)) / r.width) * 100) / 100,
            };
          }, before);
          a.facts['reader-1920-selection-vs-mark'] = { selection: sel, ...m };
          await a.shot('reader-1920-after-highlight', 4, { fullScale: true });
          await w.keyboard.press('Escape');
        }
        a.facts['reader-1920-scroll'] = await w.evaluate(() => {
          const area = document.querySelector('[data-testid="reader-pages-area"]') as HTMLElement | null;
          return area ? { scrollW: area.scrollWidth, clientW: area.clientWidth, horizontalScroll: area.scrollWidth > area.clientWidth + 1 } : null;
        });
      }
    }
    await a.setSize(1280, 800);
    await a.setTheme('dark');
    await w.waitForTimeout(800);
    await a.shot('reader-open-fit', 2);
    await a.setTheme('light');
  });
  await w.getByTestId('reader-close').click();
}

async function sectionsTour(a: Audit, ctx: LaunchedApp, lang: 'it' | 'en'): Promise<void> {
  const w = a.page;
  // Projects
  await a.step('projects empty', async () => {
    await nav(a, 'projects');
    await a.shot('projects-empty', 1);
  });
  await a.step('projects create', async () => {
    await w.getByTestId('project-create-name').fill(lang === 'it' ? 'Tesi capitolo 2' : 'Thesis chapter 2');
    await w.getByTestId('project-create').click();
    await w.waitForTimeout(800);
    // Creating a project opens it straight away.
    await a.shot('project-detail', 3);
    const tabs = w.getByTestId('project-detail').locator('[data-testid^="project-tab-"]');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click({ timeout: 4000 }).catch(() => {});
      await w.waitForTimeout(400);
      await a.shot(`project-detail-tab${i + 1}`, 4);
    }
    await w.getByTestId('project-back').click().catch(() => {});
    await w.waitForTimeout(500);
    await a.shot('projects-list', 4);
  });
  // Discover
  await a.step('discover', async () => {
    await nav(a, 'discover');
    await w.waitForTimeout(800);
    await a.shot('discover-first', 1);
    const tabs = w.getByTestId('section-discover').getByRole('tab');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click();
      await w.waitForTimeout(600);
      await a.shot(`discover-tab${i + 1}`, 2);
    }
    if (await visibleNow(w.getByTestId('watch-source-new'))) {
      await w.getByTestId('watch-source-new').click();
      await a.shot('discover-source-form', 3);
      await w.getByTestId('watch-source-cancel').click().catch(() => {});
    }
  });
  // Network
  await a.step('network', async () => {
    await nav(a, 'network');
    await w.waitForTimeout(1000);
    await a.shot('network-first', 1);
    if (await visibleNow(w.getByTestId('graph-build'))) {
      await w.getByTestId('graph-build').click();
      await w.waitForTimeout(6000);
    }
    await a.shot('network-built', 2);
    const tabs = w.getByTestId('section-network').getByRole('tablist').first().getByRole('tab');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click();
      await w.waitForTimeout(2000);
      await a.shot(`network-tab${i + 1}`, 3);
    }
  });
  // Inbox
  await a.step('inbox empty', async () => {
    await nav(a, 'inbox');
    await w.waitForTimeout(800);
    await a.shot('inbox-empty', 1);
    const tabs = w.getByTestId('section-inbox').getByRole('tab');
    if ((await tabs.count()) > 1) {
      await tabs.nth(1).click();
      await w.waitForTimeout(600);
      await a.shot('inbox-proposals-empty', 2);
      await tabs.nth(0).click();
    }
  });
  await a.step('inbox badge from a new library file', async () => {
    // A file appears in the library folder while the app is open (what a download into the folder does).
    await writeSyntheticPdf(path.join(ctx.library!.root, lang === 'it' ? 'Articoli/nuovo-arrivo.pdf' : 'Articles/new-arrival.pdf'), {
      title: lang === 'it' ? 'Un nuovo articolo appena scaricato' : 'A freshly downloaded paper',
      authors: ['Ada Example'],
      year: 2026,
      body: 'Synthetic body.',
    });
    await nav(a, 'library');
    await expect(w.getByTestId('inbox-badge')).toBeVisible({ timeout: 60_000 });
    const badge = await w.getByTestId('inbox-badge').evaluate((e) => ({ text: e.textContent, aria: e.getAttribute('aria-label'), title: e.getAttribute('title'), parentTitle: e.parentElement?.getAttribute('title') }));
    a.facts['inbox-badge'] = badge;
    await w.getByTestId('inbox-badge').hover();
    await w.waitForTimeout(800);
    await a.shot('inbox-badge-hover', 0);
    await nav(a, 'inbox');
    await w.waitForTimeout(2000);
    await a.shot('inbox-flagged-library-file', 1);
  });
  await a.step('inbox dropped pdf', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'rl-audit-drop-'));
    const src = path.join(outside, 'download.pdf');
    await writeSyntheticPdf(src, { title: 'Dropped synthetic paper on attention', authors: ['Bo Sample'], year: 2025, body: 'Body.', doi: '10.5555/audit.0001' });
    await ipcData(w, 'inbox:add', { paths: [src] });
    await w.waitForTimeout(3000);
    await a.shot('inbox-dropped-card', 1);
    const card = w.getByTestId('inbox-item').first();
    await card.screenshot({ path: path.join(OUT, `${a.run}-inbox-card-detail.png`), scale: 'css' }).catch(() => {});
  });
  await a.step('drop hint overlay', async () => {
    await w.evaluate(() => {
      const dt = new DataTransfer();
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
      document.body.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    });
    await w.waitForTimeout(500);
    await a.shot('inbox-drop-hint', 0);
    await w.evaluate(() => document.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true })));
  });
}

async function aiTour(a: Audit, lang: 'it' | 'en'): Promise<void> {
  const w = a.page;
  await a.step('enable AI for whole library', async () => {
    await nav(a, 'settings');
    await w.getByTestId('ai-settings').scrollIntoViewIfNeeded();
    await w.waitForTimeout(1500);
    await a.shot('settings-ai-before', 1);
    await w.getByTestId('ai-root-all').check();
    await w.getByTestId('ai-save').click();
    await w.waitForTimeout(800);
    await a.shot('settings-ai-after-enable', 4);
  });
  await a.step('chat with mock', async () => {
    await nav(a, 'library');
    const toggle = w.getByTestId('chat-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await w.waitForTimeout(800);
    await a.shot('chat-open-enabled', 1);
    await w.getByTestId('search-result').first().click();
    await w.getByTestId('chat-input').fill(lang === 'it' ? 'Di cosa parla questo documento?' : 'What is this document about?');
    await w.getByTestId('chat-send').click();
    await w.waitForTimeout(1500);
    if (await visibleNow(w.getByTestId('preview-confirm'))) {
      await a.shot('chat-preview-dialog', 3);
      await w.getByTestId('preview-confirm').click();
    }
    await w.waitForTimeout(4000);
    await a.shot('chat-answer', 4);
    await w.getByTestId('chat-more').click().catch(() => {});
    await w.getByTestId('chat-history-toggle').click().catch(() => {});
    await w.waitForTimeout(400);
    await a.shot('chat-history', 5);
    await w.getByTestId('chat-more').click().catch(() => {});
    await w.getByTestId('chat-history-toggle').click().catch(() => {});
    await toggle.click();
  });
  await a.step('bulk ai job', async () => {
    await w.getByTestId('search-result').first().click();
    await w.getByTestId('search-results').press('Control+a');
    await w.getByTestId('bulk-ai-propose').click();
    await expect(w.getByTestId('job-dialog')).toBeVisible({ timeout: 20_000 });
    await w.waitForTimeout(1500);
    await a.shot('job-dialog', 3);
    await w.getByTestId('job-confirm').click();
    await expect(w.getByTestId('job-indicator')).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
    await a.shot('job-done-indicator', 4);
    await w.getByTestId('job-review').click();
    await expect(w.getByTestId('review-view')).toBeVisible({ timeout: 30_000 });
    await w.waitForTimeout(1000);
    await a.shot('review-view', 5, { focus: 15 });
    const item = w.getByTestId('review-item').first();
    await item.getByTestId('review-accept').click().catch(() => {});
    await w.waitForTimeout(800);
    await a.shot('review-after-accept-toast', 6);
  });
  await a.step('labels dialog (network)', async () => {
    await nav(a, 'network');
    await w.waitForTimeout(1000);
    if (await visibleNow(w.getByTestId('map-label-clusters'))) {
      await w.getByTestId('map-label-clusters').click();
      await w.waitForTimeout(1000);
      await a.shot('network-labels-dialog', 3);
      await w.keyboard.press('Escape');
    }
  });
}

async function settingsActions(a: Audit): Promise<void> {
  const w = a.page;
  await a.step('mcp enable', async () => {
    await nav(a, 'settings');
    const mcp = w.getByTestId('mcp-settings');
    await mcp.scrollIntoViewIfNeeded();
    a.facts['mcp-enable-disabled'] = await w.getByTestId('mcp-enable').isDisabled().catch(() => null);
    await a.shot('settings-mcp-off', 1);
    // A controlled checkbox: the state changes after the main process answers, so click and wait for the badge.
    await w.getByTestId('mcp-enable').click();
    await expect(mcp.getByTestId('mcp-state')).toHaveText(/In esecuzione|Running/, { timeout: 30_000 });
    await w.waitForTimeout(800);
    await mcp.scrollIntoViewIfNeeded();
    a.facts['mcp-section-on'] = await mcp.evaluate((e) => ({ h: Math.round(e.getBoundingClientRect().height), controls: e.querySelectorAll('button, input, select, textarea').length, text: (e.textContent || '').replace(/\s+/g, ' ').slice(0, 600) }));
    await a.shot('settings-mcp-enabled', 2);
    await w.getByTestId('mcp-status').scrollIntoViewIfNeeded().catch(() => {});
    await a.shot('settings-mcp-enabled-status', 2);
    await w.evaluate(() => document.querySelector('main')?.scrollBy(0, 500));
    await a.shot('settings-mcp-enabled-lower', 2);
  });
  await a.step('backup choose destination inside the library (error state)', async () => {
    const b = w.getByTestId('backup-section');
    await b.scrollIntoViewIfNeeded();
    await w.getByTestId('backup-choose').click();
    await w.waitForTimeout(1500);
    await w.getByTestId('backup-now').scrollIntoViewIfNeeded().catch(() => {});
    await a.shot('settings-backup-after-choose', 2);
  });
  await a.step('shortcut recorder', async () => {
    const s = w.getByTestId('shortcuts-section');
    await s.scrollIntoViewIfNeeded();
    await a.shot('settings-shortcuts-table', 1);
    // Second row (chat toggle): Ctrl+K belongs to the first command, so recording it here is a conflict.
    await s.getByTestId('shortcut-change').nth(1).click();
    await w.waitForTimeout(300);
    await s.getByTestId('shortcut-recorder').scrollIntoViewIfNeeded().catch(() => {});
    await a.shot('settings-shortcut-recording', 2);
    // A key combination another command already uses: what does the conflict look like?
    await w.keyboard.press('Control+k');
    await w.waitForTimeout(500);
    a.facts['shortcut-conflict'] = await s.evaluate((e) => ({ problem: e.querySelector('[data-testid="shortcut-problem"]')?.textContent ?? null, conflicts: e.querySelector('[data-testid="shortcuts-conflicts"]')?.textContent ?? null }));
    await a.shot('settings-shortcut-conflict', 3);
    await s.getByTestId('shortcut-change').nth(2).click();
    await w.keyboard.press('Control+Alt+j');
    await w.waitForTimeout(400);
    await a.shot('settings-shortcut-recorded', 4);
    // Leave the saved shortcuts as they were: reset the draft without saving.
    await s.getByTestId('shortcuts-reset').click().catch(() => {});
    await w.keyboard.press('Escape');
  });
  await a.step('maintenance diagnostics', async () => {
    const s = w.getByTestId('maintenance-section');
    await s.scrollIntoViewIfNeeded();
    await w.getByTestId('maintenance-diagnostics').click().catch(() => {});
    await w.waitForTimeout(1500);
    await a.shot('settings-maintenance', 2);
  });
  await a.step('claude exe choose', async () => {
    const s = w.getByTestId('ai-settings');
    await s.scrollIntoViewIfNeeded();
    await a.shot('settings-ai-account-area', 1);
  });
  await a.step('new library wizard from sidebar', async () => {
    await nav(a, 'library');
    await w.getByRole('button', { name: /nuova libreria|new library/i }).first().click();
    await w.waitForTimeout(800);
    await a.shot('wizard-again-from-sidebar', 1);
    await w.getByTestId('wizard-cancel').click().catch(() => w.keyboard.press('Escape'));
  });
}

/** Backup to a folder outside the library, then restore it as a new library into an empty folder (test hooks: the
 * folder dialogs return paths set in the main process environment; no native dialog ever opens). */
async function backupRestore(a: Audit, backupDir: string, restoreRoot: string): Promise<void> {
  const w = a.page;
  await a.step('backup to a valid destination', async () => {
    await a.ctx.app.evaluate((_e, dir) => {
      process.env.RL_E2E_BACKUP_DIALOG_PATH = dir;
    }, backupDir);
    await nav(a, 'settings');
    const b = w.getByTestId('backup-section');
    await b.scrollIntoViewIfNeeded();
    await w.getByTestId('backup-choose').click();
    await expect(w.getByTestId('backup-destination')).toBeVisible({ timeout: 10_000 });
    await w.waitForTimeout(800);
    await b.scrollIntoViewIfNeeded();
    await a.shot('settings-backup-destination-ok', 2);
    await w.getByTestId('backup-now').scrollIntoViewIfNeeded();
    await w.getByTestId('backup-now').click();
    await w.waitForTimeout(600);
    await a.shot('settings-backup-running', 3);
    await expect(w.getByTestId('backup-result')).toBeVisible({ timeout: 120_000 });
    await w.waitForTimeout(800);
    await w.getByTestId('backup-result').scrollIntoViewIfNeeded();
    await a.shot('settings-backup-done', 3);
    await w.getByTestId('backup-job-close').click().catch(() => {});
    await w.waitForTimeout(800);
    await w.getByTestId('backup-list').scrollIntoViewIfNeeded().catch(() => {});
    await a.shot('settings-backup-list', 4);
  });
  await a.step('restore dialog', async () => {
    await w.getByTestId('backup-restore').first().click();
    await expect(w.getByTestId('restore-dialog')).toBeVisible();
    await w.waitForTimeout(600);
    await a.shot('restore-dialog', 5);
    // First the library root (not empty: the expected refusal), then an empty folder.
    await w.getByTestId('restore-choose-root').click();
    await w.waitForTimeout(1200);
    await a.shot('restore-root-not-empty', 6);
    await a.ctx.app.evaluate((_e, dir) => {
      process.env.RL_E2E_DIALOG_PATH = dir;
    }, restoreRoot);
    await w.getByTestId('restore-choose-root').click();
    await expect(w.getByTestId('restore-root')).toBeVisible({ timeout: 10_000 });
    await w.waitForTimeout(500);
    await a.shot('restore-root-chosen', 7);
    await w.getByTestId('restore-start').click();
    await w.waitForTimeout(600);
    await a.shot('restore-running', 8);
    await expect(w.getByTestId('restore-result')).toBeVisible({ timeout: 180_000 });
    await w.waitForTimeout(800);
    await a.shot('restore-done', 8);
    await w.getByTestId('restore-close').click();
    await w.waitForTimeout(1500);
    await a.shot('after-restore-settings', 9);
    await nav(a, 'library');
    await w.waitForTimeout(1000);
    await a.shot('after-restore-library', 10);
  });
}

/** Main screens again in dark theme and at 1920x1080 and 1024x700. */
async function matrix(a: Audit): Promise<void> {
  const w = a.page;
  const screens: [string, () => Promise<void>][] = [
    ['library', async () => nav(a, 'library')],
    ['library-detail', async () => {
      await nav(a, 'library');
      await w.getByTestId('search-result').first().click();
    }],
    ['projects', async () => nav(a, 'projects')],
    ['discover', async () => nav(a, 'discover')],
    ['network', async () => nav(a, 'network')],
    ['inbox', async () => nav(a, 'inbox')],
    ['settings', async () => nav(a, 'settings')],
    ['chat', async () => {
      await nav(a, 'library');
      const t = w.getByTestId('chat-toggle');
      if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
    }],
  ];
  const combos: [Theme, number, number][] = [
    ['dark', 1280, 800],
    ['light', 1920, 1080],
    ['dark', 1920, 1080],
    ['light', 1024, 700],
  ];
  for (const [theme, cw, ch] of combos) {
    await a.step(`matrix ${theme} ${cw}`, async () => {
      await a.setSize(cw, ch);
      await a.setTheme(theme);
      for (const [name, go] of screens) {
        await a.step(`matrix ${name}`, async () => {
          await go();
          await w.waitForTimeout(700);
          await a.shot(`m-${name}`, 1);
          if (name === 'chat') await w.getByTestId('chat-toggle').click();
        });
      }
    });
  }
  await a.setSize(1280, 800);
  await a.setTheme('light');
}

async function runTour(lang: 'it' | 'en', full: boolean): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'rl-audit-out-'));
  const exportDir = path.join(outside, 'export');
  const backupDir = path.join(outside, 'backups');
  const restoreRoot = path.join(outside, 'restored');
  for (const d of [exportDir, backupDir, restoreRoot]) mkdirSync(d, { recursive: true });
  const ctx = await launchApp({ library: lang, dialogPath: true, offline: true, env: { RL_AI_PROVIDER: 'mock', RL_E2E_EXPORT_DIALOG_PATH: exportDir } });
  const a = new Audit(lang, ctx);
  try {
    a.facts['dpr'] = await ctx.window.evaluate(() => window.devicePixelRatio);
    await a.setSize(1280, 800);
    const clicks = await wizard(a, lang, lang === 'it' ? 'La mia tesi' : 'My thesis');
    a.facts['wizard-clicks'] = clicks;
    const total = ctx.library!.manifest!.files.length;
    await waitForScan(ctx.window, total);
    await expect(ctx.window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    await ctx.window.waitForTimeout(1500);
    await a.step('welcome card', async () => {
      await a.shot('first-screen-welcome', 0, { focus: 10 });
      if (await visibleNow(ctx.window.getByTestId('welcome-card'))) {
        await ctx.window.getByTestId('welcome-card').screenshot({ path: path.join(OUT, `${lang}-welcome-card-only.png`), scale: 'css' });
        await ctx.window.getByTestId('welcome-dismiss').click();
      }
    });
    await libraryTour(a, ctx, lang);
    await sectionsTour(a, ctx, lang);
    await a.step('settings tour (before AI)', async () => settingsTour(a, 'pre'));
    if (full) {
      await aiTour(a, lang);
      await settingsActions(a);
      await a.step('settings tour (after AI)', async () => settingsTour(a, 'post'));
      await matrix(a);
      await backupRestore(a, backupDir, restoreRoot);
    }
    a.flush();
  } finally {
    a.flush();
    await ctx.close();
  }
}

test('design audit tour, Italian UI on the Italian library', async () => {
  test.skip(!ENABLED, 'design audit: set RL_DESIGN_AUDIT=1');
  test.setTimeout(40 * 60_000);
  await runTour('it', true);
});

test('design audit tour, English UI on the English library', async () => {
  test.skip(!ENABLED, 'design audit: set RL_DESIGN_AUDIT=1');
  test.setTimeout(40 * 60_000);
  await runTour('en', process.env.RL_DESIGN_AUDIT_FULL_EN === '1');
});

// ---------------------------------------------------------------------------------------------------------------------
// Wave 2 tour (audit round 5): the new shell (A2) and settings (C2), the Claude account card on a SIMULATED Claude Code
// (RL_E2E_CLAUDE_SIM, as in ai-account.spec.ts: the real program and account are never touched), the library and the
// reader (not yet migrated). The prototype P0 is compared by eye in a browser. Run on its own:
//   RL_DESIGN_AUDIT=1 RL_DESIGN_AUDIT_OUT=run6-w2 npx playwright test -c e2e/playwright.config.ts design-audit -g "wave 2"
// ---------------------------------------------------------------------------------------------------------------------

/** Runs in the page: visible controls inside `sel` (minus those inside `not`), with labels, for the counts of §17.3. */
function zoneControls([sel, not]: [string, string]) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const root = document.querySelector(sel);
  if (!root) return { found: false, n: 0, labels: [] as string[] };
  const els = [...root.querySelectorAll('button, input, select, textarea, a[href], [role=button], [role=tab], [role=radio], [role=menuitem], [role=option], summary')].filter((el) => {
    if (not && el.closest(not)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  });
  const labels = els.map((el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || (el as HTMLInputElement).placeholder || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 32));
  return { found: true, n: els.length, labels };
}

async function count(a: Audit, key: string, sel: string, not = ''): Promise<void> {
  a.facts[`count-${key}-${a.theme}-${a.size}`] = await a.page.evaluate(zoneControls, [sel, not] as [string, string]).catch((e) => String(e));
}

async function closeTransient(a: Audit): Promise<void> {
  await a.page.keyboard.press('Escape').catch(() => {});
  await a.page.waitForTimeout(250);
}

/** Every section of the one-page settings (folds closed), the search, then the Advanced folds open one at a time. */
async function settingsW2(a: Audit, prefix: string): Promise<void> {
  const w = a.page;
  const sections = ['general', 'profile', 'library', 'claude', 'backup', 'shortcuts', 'advanced'] as const;
  await a.step(`${prefix} settings open`, async () => {
    await nav(a, 'settings');
    await expect(w.getByTestId('settings-page')).toBeVisible({ timeout: 30_000 });
    await w.waitForTimeout(800);
  });
  for (const s of sections) {
    await a.step(`${prefix} settings ${s}`, async () => {
      await w.getByTestId(`settings-nav-${s}`).click();
      await expect(w.getByTestId(`settings-section-${s}`)).toBeVisible();
      await w.waitForTimeout(s === 'claude' ? 2500 : 900);
      const g = await w.evaluate(() => {
        const m = document.querySelector('main')!;
        const sc = ([...document.querySelectorAll('[data-testid="settings-page"], [data-testid="settings-page"] *')].find((e) => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) as HTMLElement | undefined) ?? m;
        return { scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight };
      });
      a.facts[`${prefix}-settings-${s}-geometry-${a.size}`] = g;
      await count(a, `${prefix}-settings-${s}`, `[data-testid="settings-section-${s}"]`);
      await a.shot(`settings-${s}`, 2, s === 'general' ? { focus: 12 } : {});
      for (let y = g.clientHeight - 60, i = 2; y < g.scrollHeight && i <= 6; y += g.clientHeight - 60, i++) {
        await w.evaluate((top) => {
          const m = document.querySelector('main')!;
          const sc = ([...document.querySelectorAll('[data-testid="settings-page"], [data-testid="settings-page"] *')].find((e) => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) as HTMLElement | undefined) ?? m;
          sc.scrollTo(0, top);
        }, y);
        await w.waitForTimeout(250);
        await a.shot(`settings-${s}-p${i}`, 2);
      }
      await w.evaluate(() => document.querySelectorAll('main, [data-testid="settings-page"] *').forEach((e) => e.scrollTop && e.scrollTo(0, 0)));
    });
  }
  await a.step(`${prefix} settings nav count`, async () => count(a, `${prefix}-settings-nav`, '[data-testid="settings-page"]', '[data-testid^="settings-section-"]'));
  await a.step(`${prefix} settings search`, async () => {
    await w.getByTestId('settings-search').fill(prefix === 'it' ? 'chiave' : 'key');
    await w.waitForTimeout(700);
    await a.shot('settings-search', 3);
    await w.getByTestId('settings-search').fill('');
  });
  for (const fold of ['claude', 'mcp', 'scan', 'export', 'maintenance']) {
    await a.step(`${prefix} advanced fold ${fold}`, async () => {
      await w.getByTestId('settings-nav-advanced').click();
      const g = w.getByTestId(`settings-fold-${fold}`);
      if ((await g.getAttribute('open')) === null) await g.locator('summary').first().click();
      await w.waitForTimeout(1200);
      await g.scrollIntoViewIfNeeded();
      await count(a, `${prefix}-advanced-${fold}`, `[data-testid="settings-fold-${fold}"]`);
      a.facts[`${prefix}-advanced-${fold}-height`] = await g.evaluate((e) => Math.round(e.getBoundingClientRect().height));
      await a.shot(`advanced-${fold}`, 3);
      await g.locator('summary').first().click();
    });
  }
}

/** The Account card in its states, driven only through the simulated Claude Code state file. */
async function accountStates(a: Audit, sim: string, lang: 'it' | 'en'): Promise<void> {
  const w = a.page;
  const st = (o: Record<string, unknown> = {}) => writeFileSync(path.join(sim, 'state.json'), JSON.stringify({ loggedIn: true, email: 'first@example.test', orgName: 'Example Org', subscriptionType: 'pro', version: '9.1.2', ...o }));
  // The page reads `claude auth status` when it opens, then only the change event: `leave` also leaves the page.
  const reopen = async (leave = true) => {
    if (leave) {
      await nav(a, 'library');
      await nav(a, 'settings');
    } else {
      await w.getByTestId('settings-nav-general').click();
      await w.waitForTimeout(300);
    }
    await w.getByTestId('settings-nav-claude').click();
    await w.waitForTimeout(2500);
  };
  const card = w.getByTestId('ai-account');
  const cardShot = async (name: string, clicks: number) => {
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await a.shot(name, clicks);
    await card.screenshot({ path: path.join(OUT, `${a.run}-card-${name}-${a.theme}.png`), scale: 'css' }).catch(() => {});
  };
  await a.step('account connected', async () => {
    st();
    await nav(a, 'settings');
    await reopen();
    await count(a, 'account-card', '[data-testid="ai-account"]');
    await cardShot('account-connected', 2);
  });
  await a.step('account test connection', async () => {
    await w.getByTestId('ai-test').click();
    await expect(w.getByTestId('ai-test-result')).toBeVisible({ timeout: 20_000 });
    await cardShot('account-tested', 3);
  });
  await a.step('account more menu', async () => {
    await w.getByTestId('ai-account-more').click();
    await w.waitForTimeout(400);
    await a.shot('account-more-menu', 3);
    await closeTransient(a);
  });
  await a.step('account change dialog', async () => {
    await w.getByTestId('ai-change-account').click();
    await w.waitForTimeout(500);
    await a.shot('account-change-dialog', 3);
    await w.getByTestId('ai-login-open').click();
    await expect(w.getByTestId('ai-login-wait')).toBeVisible();
    await a.shot('account-login-waiting', 4);
    st({ email: 'second@example.test', subscriptionType: 'max' });
    await w.getByTestId('ai-login-done').click();
    await w.waitForTimeout(1500);
    await cardShot('account-switched', 5);
  });
  await a.step('account api-key mode without key', async () => {
    await w.getByTestId('ai-auth-mode').getByRole('radio', { name: lang === 'it' ? 'Chiave API' : 'API key' }).click();
    await w.waitForTimeout(1200);
    await cardShot('account-apikey-mode-no-key', 3);
    await w.getByTestId('ai-auth-mode').getByRole('radio', { name: lang === 'it' ? 'Automatico' : 'Automatic' }).click();
    await w.waitForTimeout(800);
  });
  await a.step('account logged out', async () => {
    st({ loggedIn: false, email: undefined, subscriptionType: undefined });
    await reopen(false);
    await cardShot('account-not-logged-in-same-page', 2);
    await reopen();
    await cardShot('account-not-logged-in', 2);
  });
  await a.step('account no auth commands', async () => {
    st({ authCommands: false });
    await reopen();
    await cardShot('account-no-auth-commands', 2);
  });
  st();
}

/** Shell: sidebar, top bar, history, library switcher, Activity, palette, toast, badges. */
async function shellW2(a: Audit, lang: 'it' | 'en'): Promise<void> {
  const w = a.page;
  await a.step('shell library home', async () => {
    await nav(a, 'library');
    await w.waitForTimeout(800);
    await count(a, 'sidebar', '.app-sidebar');
    await count(a, 'topbar', '[data-testid="topbar"]');
    await count(a, 'library-view', '[data-testid="section-library"]', '[data-testid="search-results"], [data-testid="detail-pane"]');
    await a.shot('shell-library', 0, { focus: 20 });
    a.facts[`shell-geometry-${a.size}`] = await w.evaluate(() => {
      const r = (s: string) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      return { sidebar: r('.app-sidebar'), topbar: r('[data-testid="topbar"]'), main: r('main'), search: r('[data-testid="topbar-search"]'), chip: r('[data-testid="scan-status"]'), switcher: r('[data-testid="library-switcher"]'), libSearch: r('[data-testid="search-input"]') };
    });
  });
  await a.step('shell sidebar collapsed', async () => {
    await w.getByTestId('sidebar-toggle').click();
    await w.waitForTimeout(500);
    await a.shot('shell-sidebar-collapsed', 1);
    await w.getByTestId('sidebar-toggle').click();
    await w.waitForTimeout(400);
  });
  await a.step('shell library switcher', async () => {
    await w.getByTestId('library-switcher').click();
    await w.waitForTimeout(700);
    await a.shot('shell-library-switcher', 1);
    await closeTransient(a);
  });
  await a.step('shell activity idle', async () => {
    await w.getByTestId('scan-status').click();
    await expect(w.getByTestId('activity-popover')).toBeVisible();
    await w.waitForTimeout(600);
    await count(a, 'activity-popover', '[data-testid="activity-popover"]');
    await a.shot('shell-activity-idle', 1);
    await closeTransient(a);
  });
  await a.step('shell history', async () => {
    await w.getByTestId('history-toggle').click();
    await w.waitForTimeout(600);
    await a.shot('shell-history-empty', 1);
    await closeTransient(a);
  });
  await a.step('shell palette', async () => {
    await w.getByTestId('palette-open').click();
    await w.waitForTimeout(700);
    a.facts[`palette-items-empty-${a.size}`] = await w.getByTestId('palette-item').count();
    await a.shot('shell-palette', 1);
    await w.getByTestId('palette-input').fill(lang === 'it' ? 'imp' : 'sett');
    await w.waitForTimeout(500);
    await a.shot('shell-palette-typed', 2);
    await closeTransient(a);
  });
  await a.step('shell toast and activity with a job', async () => {
    await w.getByTestId('search-result').first().click();
    await w.waitForTimeout(400);
    await count(a, 'library-selection', '[data-testid="selection-bar"]');
    await a.shot('library-selection', 1);
    await w.getByTestId('bulk-citations').click();
    await w.waitForTimeout(900);
    await a.shot('shell-toast', 2);
    await w.waitForTimeout(3500);
    await a.shot('shell-activity-chip-after-job', 2);
    await w.getByTestId('scan-status').click();
    await w.waitForTimeout(700);
    await count(a, 'activity-popover-rows', '[data-testid="activity-popover"]');
    await a.shot('shell-activity-with-rows', 3);
    await closeTransient(a);
    await w.getByTestId('selection-clear').click().catch(() => {});
  });
  await a.step('shell review badge', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'rl-audit-drop-'));
    const src = path.join(outside, 'download.pdf');
    await writeSyntheticPdf(src, { title: 'Dropped synthetic paper on attention', authors: ['Bo Sample'], year: 2025, body: 'Body.', doi: '10.5555/audit.0001' });
    await ipcData(w, 'inbox:add', { paths: [src] });
    await expect(w.getByTestId('inbox-badge')).toBeVisible({ timeout: 30_000 });
    a.facts['review-badge'] = await w.getByTestId('nav-review').evaluate((e) => ({ text: e.textContent, aria: e.getAttribute('aria-label'), title: e.getAttribute('title'), badgeAria: e.querySelector('[data-testid="inbox-badge"]')?.getAttribute('aria-label') ?? null }));
    await w.getByTestId('nav-review').hover();
    await w.waitForTimeout(1200);
    await a.shot('shell-review-badge-hover', 0);
    await w.getByTestId('sidebar-toggle').click();
    await w.waitForTimeout(500);
    await w.getByTestId('nav-review').hover();
    await w.waitForTimeout(1200);
    await a.shot('shell-review-badge-collapsed', 1);
    await w.getByTestId('sidebar-toggle').click();
  });
}

/** Views that later waves migrate, as they look inside the new shell. */
async function viewsW2(a: Audit): Promise<void> {
  const w = a.page;
  for (const v of ['review', 'projects', 'discover', 'map'] as const) {
    await a.step(`view ${v} ${a.theme} ${a.size}`, async () => {
      await nav(a, v);
      await w.waitForTimeout(v === 'map' ? 2000 : 1000);
      await a.shot(`view-${v}`, 1);
    });
  }
  await a.step(`view library detail ${a.theme} ${a.size}`, async () => {
    await nav(a, 'library');
    await w.getByTestId('search-result').first().click();
    await w.getByTestId('selection-details').click();
    await w.waitForTimeout(900);
    await a.shot('view-library-detail', 2);
    await closeTransient(a);
    await w.getByTestId('selection-clear').click().catch(() => {});
  });
  await a.step(`view chat ${a.theme} ${a.size}`, async () => {
    await nav(a, 'library');
    const t = w.getByTestId('chat-toggle');
    if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
    await w.waitForTimeout(800);
    await a.shot('view-library-chat', 1);
    await t.click().catch(() => closeTransient(a));
    await w.waitForTimeout(300);
  });
}

async function readerW2(a: Audit, ctx: LaunchedApp): Promise<void> {
  const w = a.page;
  const pdf = ctx.library!.manifest!.files.find((f) => f.format === 'pdf' && f.title && f.hasText !== false)!;
  await a.step(`reader ${a.theme} ${a.size}`, async () => {
    await nav(a, 'library');
    const row = w.getByTestId('search-result').filter({ hasText: pdf.title! }).first();
    await row.hover();
    await row.getByTestId('row-read').click();
    await expect(w.getByTestId('reader')).toBeVisible();
    await expect(w.locator('[data-testid="reader-pages-area"] .page[data-page-number="1"] canvas')).toBeVisible({ timeout: 60_000 });
    await w.waitForTimeout(1500);
    const bytes = readFileSync(path.join(ctx.library!.root, pdf.relPath)).toString('latin1');
    const mb = bytes.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    const media = mb ? { w: Number(mb[3]) - Number(mb[1]), h: Number(mb[4]) - Number(mb[2]) } : null;
    a.facts[`reader-geometry-${a.theme}-${a.size}`] = { media, ...(await w.evaluate(readerGeometry)) };
    a.facts[`reader-leaked-${a.size}`] = await w.evaluate(leakedRules);
    await count(a, 'reader', '[data-testid="reader"]', '[data-testid="reader-pages-area"]');
    await a.shot('reader', 2);
    await w.getByTestId('reader-close').click().catch(() => w.keyboard.press('Escape'));
    await w.waitForTimeout(600);
  });
  await a.step(`after reader ${a.theme} ${a.size}`, async () => {
    a.facts[`after-reader-sidebar-${a.size}`] = await w.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.app-sidebar')!);
      return { radius: s.borderRadius, shadow: s.boxShadow, padding: s.padding, width: s.width };
    });
  });
}

async function runW2(lang: 'it' | 'en'): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const sim = await mkdtemp(path.join(os.tmpdir(), 'rl-claude-sim-'));
  mkdirSync(path.join(sim, '.claude'), { recursive: true });
  writeFileSync(path.join(sim, 'state.json'), JSON.stringify({ loggedIn: true, email: 'first@example.test', orgName: 'Example Org', subscriptionType: 'pro', version: '9.1.2' }));
  writeFileSync(path.join(sim, '.claude', '.credentials.json'), '{}');
  const ctx = await launchApp({ library: lang, dialogPath: true, offline: true, env: { RL_E2E: '1', RL_E2E_CLAUDE_SIM: sim, RL_AI_PROVIDER: 'mock' } });
  const a = new Audit(`w2${lang}`, ctx);
  try {
    a.facts['dpr'] = await ctx.window.evaluate(() => window.devicePixelRatio);
    await a.setSize(1280, 800);
    await wizard(a, lang, lang === 'it' ? 'La mia tesi' : 'My thesis');
    const total = ctx.library!.manifest!.files.length;
    await waitForScan(ctx.window, total);
    await expect(ctx.window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    await ctx.window.waitForTimeout(1500);
    await a.step('first screen', async () => {
      await a.shot('first-screen', 0);
      if (await visibleNow(ctx.window.getByTestId('welcome-dismiss'))) await ctx.window.getByTestId('welcome-dismiss').click();
    });
    await shellW2(a, lang);
    await settingsW2(a, lang);
    await accountStates(a, sim, lang);
    await viewsW2(a);
    await readerW2(a, ctx);
    const combos: [Theme, number, number][] = [
      ['dark', 1280, 800],
      ['light', 1920, 1080],
      ['dark', 1920, 1080],
    ];
    for (const [theme, cw, ch] of combos) {
      await a.setSize(cw, ch);
      await a.setTheme(theme);
      await a.step(`matrix shell ${theme} ${cw}`, async () => {
        await nav(a, 'library');
        await count(a, 'topbar', '[data-testid="topbar"]');
        await a.shot('shell-library', 1);
        await a.page.getByTestId('scan-status').click();
        await a.page.waitForTimeout(600);
        await a.shot('shell-activity', 1);
        await closeTransient(a);
        await a.page.getByTestId('palette-open').click();
        await a.page.waitForTimeout(600);
        await a.shot('shell-palette', 1);
        await closeTransient(a);
      });
      await a.step(`matrix settings ${theme} ${cw}`, async () => {
        await nav(a, 'settings');
        for (const s of ['general', 'claude', 'advanced', 'backup']) {
          await a.page.getByTestId(`settings-nav-${s}`).click();
          await a.page.waitForTimeout(s === 'claude' ? 2000 : 700);
          await a.shot(`settings-${s}`, 1);
        }
      });
      if (lang === 'it' || theme === 'light') await viewsW2(a);
      await readerW2(a, ctx);
    }
    await a.setSize(1280, 800);
    await a.setTheme('light');
  } finally {
    a.flush();
    await ctx.close();
    rmSync(sim, { recursive: true, force: true });
  }
}

test('design audit wave 2 tour, Italian', async () => {
  test.skip(!ENABLED, 'design audit: set RL_DESIGN_AUDIT=1');
  test.setTimeout(30 * 60_000);
  await runW2('it');
});

test('design audit wave 2 tour, English', async () => {
  test.skip(!ENABLED, 'design audit: set RL_DESIGN_AUDIT=1');
  test.setTimeout(30 * 60_000);
  await runW2('en');
});

// ---------------------------------------------------------------------------------------------------------------------
// Final tour (audit round 6, task Y1): the whole app after every wave, on a synthetic corpus large enough for the Map
// (authors, years, folders), with the mock AI provider, no network and a SIMULATED Claude Code (RL_E2E_CLAUDE_SIM: the
// real program and account are never touched). Italian at 1280x800 light, then a matrix of key screens in dark and at
// 1920x1080; English spot checks in a second test. Run on its own (heavy: one Playwright run at a time):
//   RL_DESIGN_AUDIT=1 RL_DESIGN_AUDIT_OUT=run8-final npx playwright test -c e2e/playwright.config.ts design-audit -g "final"
// ---------------------------------------------------------------------------------------------------------------------

/** Items of the menus open now (for the 7-item cap of §17.3). */
async function countMenu(a: Audit, key: string): Promise<void> {
  a.facts[`menu-${key}`] = await a.page
    .evaluate(() =>
      [...document.querySelectorAll('[role=menu], [role=listbox], details[open]')]
        .filter((m) => (m as HTMLElement).offsetParent !== null)
        .map((m) =>
          [...m.querySelectorAll('[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=option], label')]
            .filter((e) => (e as HTMLElement).offsetParent !== null)
            .map((e) => (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)),
        ),
    )
    .catch((e) => String(e));
}

async function finalWizard(a: Audit, lang: 'it' | 'en', name: string): Promise<void> {
  const w = a.page;
  await expect(w.getByTestId('wizard')).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 12; i++) {
    const title = ((await w.getByTestId('wizard-step-title').textContent().catch(() => '')) ?? '').trim().slice(0, 24).replace(/[^\p{L}\p{N}]+/gu, '_');
    if (await visibleNow(w.getByTestId('wizard-ui-language'))) await w.getByTestId('wizard-ui-language').selectOption(lang);
    await w.waitForTimeout(300);
    await a.shot(`wizard-${i + 1}-${title}`, i);
    if ((await visibleNow(w.getByTestId('wizard-choose-folder'))) && !(await visibleNow(w.getByTestId('wizard-folder-chosen')))) {
      await w.getByTestId('wizard-choose-folder').click();
      await expect(w.getByTestId('wizard-folder-chosen')).toBeVisible();
      await a.shot(`wizard-${i + 1}-folder-chosen`, i + 1);
    }
    if (await visibleNow(w.getByTestId('wizard-lib-name'))) await w.getByTestId('wizard-lib-name').fill(name);
    if (await visibleNow(w.getByTestId('wizard-create'))) {
      await w.getByTestId('wizard-create').click();
      await w.waitForTimeout(2500);
      await a.shot('wizard-scan', i + 1);
      await w.locator('[data-testid="wizard-scan-background"], [data-testid="wizard-scan-open"]:enabled').first().click({ timeout: 120_000 });
      break;
    }
    await w.getByTestId('wizard-next').click();
  }
  await expect(w.getByTestId('wizard')).toHaveCount(0, { timeout: 30_000 });
}

async function openMenu(a: Audit, testId: string, shot: string, clicks: number): Promise<void> {
  await a.step(shot, async () => {
    await a.page.getByTestId(testId).first().click();
    await a.page.waitForTimeout(500);
    await countMenu(a, shot);
    await a.shot(shot, clicks);
    await closeTransient(a);
  });
}

async function findRow(a: Audit, title: string): Promise<Locator> {
  const w = a.page;
  await nav(a, 'library');
  const input = w.getByTestId('search-input');
  await input.fill(title.split(' ').slice(0, 4).join(' '));
  await input.press('Enter');
  await w.waitForTimeout(1500);
  return w.getByTestId('search-result').filter({ hasText: title }).first();
}

async function clearSearch(a: Audit): Promise<void> {
  await a.page.getByTestId('search-input').fill('').catch(() => {});
  await a.page.getByTestId('search-input').press('Enter').catch(() => {});
  await closeTransient(a);
}

async function libraryFinal(a: Audit): Promise<void> {
  const w = a.page;
  await a.step('library home', async () => {
    await nav(a, 'library');
    await w.waitForTimeout(1200);
    await count(a, 'sidebar', '.app-sidebar');
    await count(a, 'topbar', '[data-testid="topbar"]');
    await count(a, 'library-head', '.library-head');
    await count(a, 'library-filters', '[data-testid="facet-bar"]');
    await a.shot('library', 0, { focus: 25 });
  });
  await openMenu(a, 'add-menu', 'library-add-menu', 1);
  await openMenu(a, 'library-more', 'library-more-menu', 1);
  await a.step('library view menu', async () => {
    await w.getByTestId('view-menu').click();
    await w.waitForTimeout(400);
    await a.shot('library-view-menu', 1);
    await w.getByTestId('view-grid').click().catch(() => {});
    await w.waitForTimeout(800);
    await closeTransient(a);
    await a.shot('library-grid', 2);
    await w.getByTestId('view-menu').click();
    await w.getByTestId('view-list').click().catch(() => {});
    await closeTransient(a);
  });
  await a.step('library row hover and selection', async () => {
    const row = w.getByTestId('search-result').nth(1);
    await row.hover();
    await w.waitForTimeout(300);
    await a.shot('library-row-hover', 0);
    await row.click();
    await w.waitForTimeout(400);
    await count(a, 'library-selection-1', '[data-testid="selection-bar"]');
    await a.shot('library-selected-1', 1);
    await w.getByTestId('search-result').nth(2).click({ modifiers: ['Control'] });
    await w.waitForTimeout(400);
    await count(a, 'library-selection-2', '[data-testid="selection-bar"]');
    await a.shot('library-selected-2', 2);
  });
  await openMenu(a, 'bulk-claude', 'selection-claude-menu', 3);
  await openMenu(a, 'selection-more', 'selection-more-menu', 3);
  await a.step('literature note dialog', async () => {
    await w.getByTestId('bulk-claude').click();
    await w.getByTestId('selection-literature').click();
    await w.waitForTimeout(1200);
    await a.shot('literature-dialog', 4);
    await closeTransient(a);
  });
  await a.step('compare table', async () => {
    await w.getByTestId('bulk-claude').click();
    await w.getByTestId('selection-compare').click();
    await w.waitForTimeout(1500);
    await a.shot('compare-open', 4);
    if (await visibleNow(w.getByTestId('compare-run'))) {
      await w.getByTestId('compare-run').click();
      await w.waitForTimeout(1500);
      await a.shot('compare-run-confirm', 5);
      const yes = w.locator('.rl-dialog .dialog-foot button.primary, .rl-dialog footer button.primary').last();
      if (await visibleNow(yes)) await yes.click();
      await w.waitForTimeout(5000);
      await count(a, 'compare-view', '[data-testid="compare-view"]', '[data-testid="compare-table"] tbody');
      await a.shot('compare-table', 6);
    }
    await closeTransient(a);
    await w.getByTestId('compare-close').click().catch(() => {});
    await w.waitForTimeout(500);
  });
  await a.step('export dialog', async () => {
    await nav(a, 'library');
    if (!(await visibleNow(w.getByTestId('selection-bar')))) {
      await w.getByTestId('search-result').nth(1).click();
      await w.getByTestId('search-result').nth(2).click({ modifiers: ['Control'] });
    }
    await w.getByTestId('selection-more').click();
    await w.getByRole('menuitem', { name: /Esporta|Export/ }).first().click();
    await w.waitForTimeout(1200);
    await count(a, 'export-dialog', '[data-testid="export-dialog"]');
    await a.shot('export-dialog', 4);
    const fmt = w.getByTestId('export-format');
    if (await visibleNow(fmt)) {
      await fmt.scrollIntoViewIfNeeded();
      await a.shot('export-dialog-format', 4);
    }
    await closeTransient(a);
  });
  await a.step('document card', async () => {
    await nav(a, 'library');
    await w.getByTestId('selection-clear').click().catch(() => {});
    const row = w.getByTestId('search-result').nth(1);
    await row.hover();
    await row.getByTestId('row-detail').click();
    await w.waitForTimeout(1200);
    await count(a, 'doc-card', '[data-testid="doc-panel"]');
    await a.shot('doc-card', 2, { focus: 15 });
  });
  await openMenu(a, 'doc-more', 'doc-card-more-menu', 3);
  await a.step('doc card sections open', async () => {
    const toggles = w.locator('[data-testid="doc-panel"] .card-section__toggle');
    const n = await toggles.count();
    for (let i = 0; i < n; i++) await toggles.nth(i).click().catch(() => {});
    await w.waitForTimeout(1500);
    await a.shot('doc-card-sections-open', 2 + n);
    await w.getByTestId('doc-panel').evaluate((e) => {
      const sc = [e, ...e.querySelectorAll('*')].find((x) => x.scrollHeight > x.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(x).overflowY)) as HTMLElement | undefined;
      sc?.scrollTo(0, sc.scrollHeight);
    });
    await w.waitForTimeout(400);
    await a.shot('doc-card-bottom', 2 + n);
    await w.getByTestId('panel-close').click().catch(() => {});
  });
}

async function readerFinal(a: Audit, pdfs: string[], full: boolean): Promise<void> {
  const w = a.page;
  await a.step(`reader open ${a.theme} ${a.size}`, async () => {
    const row = await findRow(a, pdfs[0]!);
    await row.hover();
    await row.getByTestId('row-read').click();
    await expect(w.getByTestId('reader')).toBeVisible();
    await expect(w.locator('[data-testid="reader-pages-area"] .page[data-page-number="1"] canvas')).toBeVisible({ timeout: 60_000 });
    await w.waitForTimeout(1500);
    await count(a, 'reader-bar', '[data-testid="reader-bar"]');
    a.facts[`reader-geometry-${a.theme}-${a.size}`] = await w.evaluate(readerGeometry);
    await a.shot('reader', 2);
  });
  if (full) {
    await openMenu(a, 'reader-zoom', 'reader-zoom-menu', 3);
    await openMenu(a, 'reader-study-menu', 'reader-study-menu', 3);
    await openMenu(a, 'reader-more', 'reader-more-menu', 3);
    await openMenu(a, 'ann-color', 'reader-color-menu', 3);
    await a.step('reader highlight popover', async () => {
      await w.getByTestId('reader-tool-highlight').click().catch(() => w.keyboard.press('h'));
      const box = await w.locator('[data-testid="reader-pages-area"] .page[data-page-number="1"]').boundingBox();
      if (box) {
        await w.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.22);
        await w.mouse.down();
        await w.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.22, { steps: 8 });
        await w.mouse.up();
      }
      await w.waitForTimeout(800);
      await a.shot('reader-after-highlight', 4);
      const mark = w.getByTestId('annotation-mark').first();
      if (await visibleNow(mark)) {
        await w.getByTestId('reader-tool-select').click().catch(() => w.keyboard.press('v'));
        await mark.click();
        await w.waitForTimeout(500);
        await count(a, 'reader-ann-popover', '[data-testid="annotation-bar"]');
        await a.shot('reader-annotation-popover', 6);
      }
      await closeTransient(a);
    });
    await a.step('reader side panel', async () => {
      await w.getByTestId('reader-side').click();
      await w.waitForTimeout(800);
      await count(a, 'reader-side-panel', '[data-testid="reader-side-panel"]');
      await a.shot('reader-panel', 3);
      await w.getByTestId('reader-tab-notes').click().catch(() => {});
      await w.waitForTimeout(500);
      await a.shot('reader-panel-notes', 4);
      await w.getByTestId('reader-side').click();
    });
    await a.step('reader find', async () => {
      await w.getByTestId('reader-find-toggle').click();
      await w.getByTestId('reader-find-input').fill('the');
      await w.waitForTimeout(800);
      await a.shot('reader-find', 3);
      await closeTransient(a);
    });
    await a.step('reader side by side', async () => {
      await w.getByTestId('reader-more').click();
      await w.getByTestId('reader-side-by-side').click();
      await w.waitForTimeout(800);
      await a.shot('reader-split-picker', 3);
      const s = w.getByTestId('reader-split-search');
      if (await visibleNow(s)) await s.fill(pdfs[1]!.split(' ').slice(0, 3).join(' '));
      await w.waitForTimeout(1200);
      await w.getByTestId('reader-split-hit').first().click();
      await w.waitForTimeout(3500);
      await count(a, 'reader-split', '[data-testid="reader"]', '[data-testid="reader-pages-area"]');
      await a.shot('reader-split', 5);
    });
  }
  await a.step(`reader close ${a.theme} ${a.size}`, async () => {
    await w.getByTestId('reader-close').first().click().catch(() => w.keyboard.press('Escape'));
    await w.waitForTimeout(600);
    await clearSearch(a);
  });
}

async function reviewFinal(a: Audit, full: boolean): Promise<void> {
  const w = a.page;
  if (full)
    await a.step('review drop a file', async () => {
      const outside = await mkdtemp(path.join(os.tmpdir(), 'rl-audit-drop-'));
      const src = path.join(outside, 'download.pdf');
      await writeSyntheticPdf(src, { title: 'Attenzione sparsa per sequenze lunghe', authors: ['Bo Sample'], year: 2025, body: 'Corpo.', doi: '10.5555/audit.0001' });
      await ipcData(w, 'inbox:add', { paths: [src] });
      await expect(w.getByTestId('inbox-badge')).toBeVisible({ timeout: 30_000 });
    });
  await a.step(`review arrivals ${a.theme} ${a.size}`, async () => {
    await nav(a, 'review');
    await w.waitForTimeout(1500);
    await count(a, 'review-head', '.rh-head');
    await count(a, 'review-arrivals', '.rh-panel');
    await a.shot('review-arrivals', 1);
  });
  if (!full) return;
  await a.step('review proposals', async () => {
    await w.getByTestId('inbox-tab-proposals').click();
    await w.waitForTimeout(1500);
    await count(a, 'review-proposals', '.rh-panel');
    await a.shot('review-proposals', 2);
    await w.getByTestId('inbox-tab-arrivals').click();
  });
}

async function mapFinal(a: Audit, full: boolean): Promise<void> {
  const w = a.page;
  await a.step(`map ${a.theme} ${a.size}`, async () => {
    await nav(a, 'map');
    await w.waitForTimeout(1200);
    if (await visibleNow(w.getByTestId('graph-build-empty'))) {
      await a.shot('map-empty', 1);
      await w.getByTestId('graph-build-empty').click();
    }
    await expect(w.getByTestId('map-canvas')).toBeVisible({ timeout: 240_000 });
    await expect(w.getByTestId('graph-status')).not.toHaveAttribute('data-state', 'building', { timeout: 240_000 });
    await w.waitForTimeout(3500);
    await count(a, 'map-head', '[data-testid="section-network"]', 'canvas, [data-testid="cluster-legend"]');
    await a.shot('map', 2, full ? { focus: 20 } : {});
  });
  await a.step(`map network ${a.theme} ${a.size}`, async () => {
    await w.getByTestId('net-tab-network').click();
    await w.waitForTimeout(3500);
    await count(a, 'map-network', '[data-testid="section-network"]', 'canvas');
    await a.shot('map-network-docs', 3);
    for (const m of full ? ['author', 'tag', 'topic'] : ['author']) {
      await w.getByTestId(`net-mode-${m}`).click().catch(() => {});
      await expect(w.getByTestId('ent-canvas')).toHaveAttribute('data-loading', 'false', { timeout: 60_000 }).catch(() => {});
      await w.waitForTimeout(3000);
      await a.shot(`map-network-${m}`, 4);
    }
  });
  if (!full) {
    await w.getByTestId('net-tab-map').click().catch(() => {});
    return;
  }
  await a.step('map entity detail', async () => {
    await w.getByTestId('net-mode-author').click().catch(() => {});
    await w.waitForTimeout(2500);
    const c = await w.getByTestId('ent-canvas').boundingBox();
    for (const [dx, dy] of [[0, 0], [30, 20], [-40, -30], [60, -40], [-70, 50]]) {
      if (!c) break;
      await w.mouse.click(c.x + c.width / 2 + dx!, c.y + c.height / 2 + dy!);
      await w.waitForTimeout(700);
      if (await visibleNow(w.getByTestId('entity-detail'))) break;
    }
    await a.shot('map-entity-detail', 5);
  });
  await a.step('map explore', async () => {
    await w.getByTestId('net-tab-explore').click();
    await w.waitForTimeout(2500);
    await a.shot('map-explore', 2);
  });
  await a.step('map surprising', async () => {
    await w.getByTestId('net-tab-surprising').click();
    await w.waitForTimeout(2500);
    await a.shot('map-surprising', 2);
  });
  await a.step('map more menu', async () => {
    await w.getByTestId('net-tab-map').click();
    await w.waitForTimeout(2500);
    await w.getByTestId('map-more').click();
    await w.waitForTimeout(400);
    await countMenu(a, 'map-more');
    await a.shot('map-more-menu', 3);
    await w.getByTestId('map-more').click();
  });
  await a.step('map node card and bridge', async () => {
    const c = await w.getByTestId('map-canvas').boundingBox();
    for (const [dx, dy] of [[0, 0], [40, 20], [-60, -30], [80, -60], [-100, 50], [120, 90], [-20, 110], [150, -20]]) {
      if (!c) break;
      await w.mouse.move(c.x + c.width / 2 + dx!, c.y + c.height / 2 + dy!, { steps: 4 });
      await w.waitForTimeout(900);
      if (await visibleNow(w.getByTestId('map-card-more'))) break;
    }
    await a.shot('map-node-card', 4);
    if (await visibleNow(w.getByTestId('map-card-more'))) {
      await w.getByTestId('map-card-more').click();
      await w.waitForTimeout(400);
      await a.shot('map-node-card-more', 5);
      await w.getByRole('menuitem').first().click().catch(() => {});
      await w.waitForTimeout(800);
      await a.shot('map-bridge-pick', 6);
      for (const [dx, dy] of [[-150, -100], [160, 110], [-200, 120], [210, -120], [-250, 0], [250, 40]]) {
        if (!c) break;
        await w.mouse.click(c.x + c.width / 2 + dx!, c.y + c.height / 2 + dy!);
        await w.waitForTimeout(900);
        if (await visibleNow(w.getByTestId('map-bridge-note'))) break;
      }
      await w.waitForTimeout(1500);
      await a.shot('map-bridge', 7);
    }
    await closeTransient(a);
  });
  await a.step('map surprise', async () => {
    await w.getByTestId('map-bridge-close').click().catch(() => {});
    await w.getByTestId('map-surprise').click().catch(() => {});
    await w.waitForTimeout(2500);
    await a.shot('map-surprise', 3);
  });
}

async function discoverFinal(a: Audit, pdfs: string[], full: boolean): Promise<void> {
  const w = a.page;
  await a.step(`discover ${a.theme} ${a.size}`, async () => {
    await nav(a, 'discover');
    await w.waitForTimeout(1200);
    await count(a, 'discover', '[data-testid="section-discover"]');
    await a.shot('discover', 1);
  });
  if (!full) return;
  await openMenu(a, 'discover-new-search', 'discover-new-menu', 2);
  await openMenu(a, 'discover-more', 'discover-more-menu', 2);
  await a.step('discover bridge search', async () => {
    const row = await findRow(a, pdfs[0]!);
    await row.click();
    const row2 = await findRow(a, pdfs[1]!);
    await row2.click({ modifiers: ['Control'] });
    await w.getByTestId('selection-more').click();
    await w.waitForTimeout(400);
    await a.shot('selection-more-two', 4);
    await w.getByTestId('selection-bridge').click();
    await expect(w.getByTestId('discover-searches')).toBeVisible({ timeout: 30_000 });
    await w.waitForTimeout(6000);
    await a.shot('discover-bridge-run', 5);
  });
  await a.step('discover tabs', async () => {
    const tabs = w.locator('[data-testid="section-discover"] [role=tab]');
    const n = await tabs.count();
    for (let i = 1; i < Math.min(n, 4); i++) {
      await tabs.nth(i).click();
      await w.waitForTimeout(1200);
      await a.shot(`discover-tab${i + 1}`, 2);
    }
  });
  await a.step('discover cleanup', async () => {
    await nav(a, 'library');
    await clearSearch(a);
    await w.getByTestId('selection-clear').click().catch(() => {});
  });
}

async function projectsFinal(a: Audit, full: boolean): Promise<void> {
  const w = a.page;
  if (full) {
    await a.step('projects empty', async () => {
      await nav(a, 'projects');
      await w.waitForTimeout(1000);
      await a.shot('projects-empty', 1);
    });
    await a.step('project create from selection', async () => {
      await nav(a, 'library');
      await clearSearch(a);
      for (let i = 0; i < 5; i++) await w.getByTestId('search-result').nth(i).click({ modifiers: i ? ['Control'] : [] });
      await w.getByTestId('add-to-project-button').click();
      await w.waitForTimeout(500);
      await a.shot('project-add-popover', 3);
      await w.getByTestId('new-project-name').fill('Capitolo 2 · Metodi');
      await w.getByTestId('create-project-with-selection').click();
      await w.waitForTimeout(1200);
      await w.getByTestId('selection-clear').click().catch(() => {});
    });
  }
  await a.step(`project detail ${a.theme} ${a.size}`, async () => {
    await nav(a, 'projects');
    await w.waitForTimeout(800);
    await count(a, 'projects-list', '[data-testid="section-projects"]');
    if (full) await a.shot('projects-list', 1);
    await w.getByTestId('project-open').first().click();
    await w.waitForTimeout(1500);
    await count(a, 'project-head', '[data-testid="project-detail"]', '[data-testid="project-members"] table');
    await a.shot('project', 2);
  });
  if (!full) return;
  await openMenu(a, 'project-more', 'project-more-menu', 3);
  for (const tab of ['plan', 'notes']) {
    await a.step(`project tab ${tab}`, async () => {
      await w.getByTestId(`project-tab-${tab}`).click();
      await w.waitForTimeout(900);
      await a.shot(`project-tab-${tab}`, 3);
    });
  }
  await a.step('project schema', async () => {
    if (await visibleNow(w.getByTestId('notes-write-outline'))) await w.getByTestId('notes-write-outline').click();
    else await w.getByTestId('project-tab-schema').click();
    await w.waitForTimeout(1000);
    await a.shot('project-schema-edit', 4);
    const q = w.getByTestId('schema-input-questions');
    if (await visibleNow(q)) {
      await q.fill('Come cambia la precisione con sequenze lunghe?\nQuale metodo regge meglio il rumore?');
      await w.getByTestId('schema-input-idea').fill('Le sequenze lunghe richiedono attenzione sparsa.').catch(() => {});
      await w.getByTestId('schema-save').click();
      await w.waitForTimeout(1200);
    }
    await count(a, 'project-tabs', '[data-testid="project-detail"] [role=tablist]');
    await a.shot('project-schema', 5);
  });
  await a.step('project prisma', async () => {
    await w.getByTestId('project-more').click();
    await w.getByTestId('project-prisma').click();
    await w.waitForTimeout(1500);
    await a.shot('project-prisma', 4);
    await closeTransient(a);
    await w.getByTestId('prisma-close').click().catch(() => {});
  });
  await a.step('project export', async () => {
    await w.getByTestId('project-more').click();
    await w.getByTestId('project-export').click();
    await w.waitForTimeout(1200);
    await a.shot('project-export', 4);
    const fmt = w.getByTestId('export-format');
    if (await visibleNow(fmt)) {
      await fmt.scrollIntoViewIfNeeded();
      await a.shot('project-export-format', 4);
    }
    await closeTransient(a);
  });
}

async function settingsFinal(a: Audit, full: boolean): Promise<void> {
  const w = a.page;
  const secs = full ? ['general', 'profile', 'library', 'claude', 'backup', 'shortcuts', 'advanced'] : ['claude'];
  await a.step(`settings open ${a.theme} ${a.size}`, async () => nav(a, 'settings'));
  for (const s of secs) {
    await a.step(`settings ${s} ${a.theme} ${a.size}`, async () => {
      await w.getByTestId(`settings-nav-${s}`).click();
      await w.waitForTimeout(s === 'claude' ? 2500 : 800);
      await count(a, `settings-${s}`, `[data-testid="settings-section-${s}"]`);
      await a.shot(`settings-${s}`, 2);
    });
  }
  if (!full) return;
  await a.step('settings token cap', async () => {
    await w.getByTestId('settings-nav-claude').click();
    await w.waitForTimeout(1200);
    await w.getByTestId('token-cap-input').scrollIntoViewIfNeeded();
    await w.waitForTimeout(400);
    await a.shot('settings-token-cap', 3);
  });
}

async function shellFinal(a: Audit): Promise<void> {
  const w = a.page;
  await a.step('activity popover', async () => {
    await nav(a, 'library');
    await w.getByTestId('scan-status').click();
    await w.waitForTimeout(600);
    await a.shot('activity', 1);
    await closeTransient(a);
  });
  await a.step('palette', async () => {
    await w.getByTestId('palette-open').click();
    await w.waitForTimeout(600);
    await a.shot('palette', 1);
    await closeTransient(a);
  });
  await a.step('search menu', async () => {
    await w.getByTestId('search-input').click();
    await w.waitForTimeout(600);
    await a.shot('search-menu', 1);
    await closeTransient(a);
  });
  await a.step('chat panel', async () => {
    const t = w.getByTestId('chat-toggle');
    if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
    await w.waitForTimeout(1000);
    await count(a, 'chat-panel', '[data-testid="chat-panel"]');
    await a.shot('chat-panel', 1);
    await t.click().catch(() => closeTransient(a));
  });
}

async function runFinal(lang: 'it' | 'en'): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const sim = await mkdtemp(path.join(os.tmpdir(), 'rl-claude-sim-'));
  mkdirSync(path.join(sim, '.claude'), { recursive: true });
  writeFileSync(path.join(sim, 'state.json'), JSON.stringify({ loggedIn: true, email: 'first@example.test', orgName: 'Example Org', subscriptionType: 'pro', version: '9.1.2' }));
  writeFileSync(path.join(sim, '.claude', '.credentials.json'), '{}');
  const full = lang === 'it';
  const ctx = await launchApp({ library: { corpus: full ? 220 : 120, options: { language: lang, pdfShare: 0.08, seed: 11 } }, dialogPath: true, offline: true, env: { RL_E2E: '1', RL_E2E_CLAUDE_SIM: sim, RL_AI_PROVIDER: 'mock' } });
  const a = new Audit(`f${lang}`, ctx);
  try {
    a.facts['dpr'] = await ctx.window.evaluate(() => window.devicePixelRatio);
    await a.setSize(1280, 800);
    await finalWizard(a, lang, lang === 'it' ? 'La mia tesi' : 'My thesis');
    const corpus = ctx.library!.corpus!;
    await waitForScan(ctx.window, corpus.count);
    await expect(ctx.window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 300_000 });
    const pdfs = corpus.files.filter((f) => f.format === 'pdf' && f.pages.length > 1).map((f) => f.title);
    const top = [...new Set(corpus.dirs.map((d) => d.split('/')[0]!))];
    await ipcData(ctx.window, 'library:setConfig', { patch: { aiEnabledFolders: top } }).catch(() => {});
    await ctx.window.waitForTimeout(1500);
    await a.step('first screen', async () => {
      await a.shot('first-screen', 0);
      if (await visibleNow(ctx.window.getByTestId('welcome-dismiss'))) await ctx.window.getByTestId('welcome-dismiss').click();
    });
    await libraryFinal(a);
    await readerFinal(a, pdfs, full);
    await reviewFinal(a, true);
    await mapFinal(a, full);
    await discoverFinal(a, pdfs, full);
    await projectsFinal(a, true);
    await settingsFinal(a, full);
    if (full) await shellFinal(a);
    const combos: [Theme, number, number][] = full
      ? [
          ['dark', 1280, 800],
          ['light', 1920, 1080],
          ['dark', 1920, 1080],
        ]
      : [];
    for (const [theme, cw, ch] of combos) {
      await a.setSize(cw, ch);
      await a.setTheme(theme);
      await a.step(`matrix library ${theme} ${cw}`, async () => {
        await nav(a, 'library');
        await clearSearch(a);
        await a.page.waitForTimeout(800);
        await a.shot('library', 0);
      });
      await readerFinal(a, pdfs, false);
      await reviewFinal(a, false);
      await mapFinal(a, false);
      await discoverFinal(a, pdfs, false);
      await projectsFinal(a, false);
      await settingsFinal(a, false);
    }
    await a.setSize(1280, 800);
    await a.setTheme('light');
  } finally {
    a.flush();
    await ctx.close();
    rmSync(sim, { recursive: true, force: true });
  }
}

test('design audit final tour, Italian', async () => {
  test.skip(!ENABLED, 'design audit: set RL_DESIGN_AUDIT=1');
  test.setTimeout(45 * 60_000);
  await runFinal('it');
});

test('design audit final tour, English spot checks', async () => {
  test.skip(!ENABLED, 'design audit: set RL_DESIGN_AUDIT=1');
  test.setTimeout(30 * 60_000);
  await runFinal('en');
});
