import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeSyntheticPdf } from '@rl/testkit';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const OUT = path.resolve(import.meta.dirname, '../audit-shots');

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
      // Leave transient UI (dialogs, menus) behind so the next step starts clean.
      await this.page.keyboard.press('Escape').catch(() => {});
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
    // The card opens with a second click on the selected row (or Enter, or the selection bar button).
    await rowsL.first().click();
    await expect(w.getByTestId('detail-pane')).toBeVisible();
    await w.waitForTimeout(500);
    await a.shot('library-detail', 2, { focus: 15 });
  });
  await a.step('detail similar', async () => {
    await w.getByTestId('similar-toggle').click();
    await w.waitForTimeout(800);
    await a.shot('library-detail-similar', 2);
  });
  await a.step('detail citations', async () => {
    await w.getByTestId('citations-toggle').click();
    await w.waitForTimeout(800);
    await a.shot('library-detail-citations', 2);
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
    await w.waitForTimeout(1200);
    await a.shot('export-dialog-from-selection', 3);
    await w.keyboard.press('Escape');
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
    await w.keyboard.press('F1');
    await w.waitForTimeout(800);
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
}

async function readerTour(a: Audit, ctx: LaunchedApp, title: string, relPath: string): Promise<void> {
  const w = a.page;
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
          const mark = await w.evaluate((n) => {
            const m = document.querySelectorAll('[data-testid="annotation-mark"]')[n];
            if (!m) return null;
            const r = m.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }, before);
          a.facts['reader-1920-selection-vs-mark'] = { selection: sel, mark };
          await a.shot('reader-1920-after-highlight', 4, { fullScale: true });
        }
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
    const tabs = w.getByTestId('project-detail').getByRole('tab');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click();
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
    await w.getByTestId('chat-history-toggle').click().catch(() => {});
    await w.waitForTimeout(400);
    await a.shot('chat-history', 5);
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
    await w.getByTestId('mcp-enable').click({ force: true });
    await w.waitForTimeout(2500);
    await w.getByTestId('mcp-status').scrollIntoViewIfNeeded().catch(() => {});
    await a.shot('settings-mcp-enabled', 2);
  });
  await a.step('backup choose destination (library root via dialog override)', async () => {
    const b = w.getByTestId('backup-section');
    await b.scrollIntoViewIfNeeded();
    await w.getByTestId('backup-choose').click();
    await w.waitForTimeout(1500);
    await w.getByTestId('backup-now').scrollIntoViewIfNeeded().catch(() => {});
    await a.shot('settings-backup-after-choose', 2);
  });
  await a.step('restore dialog', async () => {
    const btn = w.getByTestId('backup-open-file');
    if (await visibleNow(btn)) {
      await btn.click();
      await w.waitForTimeout(1500);
      await a.shot('settings-restore-attempt', 2);
      await w.keyboard.press('Escape');
    }
  });
  await a.step('shortcut recorder', async () => {
    const s = w.getByTestId('shortcuts-section');
    await s.scrollIntoViewIfNeeded();
    await w.getByTestId('shortcut-change').first().click();
    await w.waitForTimeout(300);
    await a.shot('settings-shortcut-recording', 2);
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
  const ctx = await launchApp({ library: lang, dialogPath: true, offline: true, env: { RL_AI_PROVIDER: 'mock' } });
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
    }
    a.flush();
  } finally {
    a.flush();
    await ctx.close();
  }
}

test('design audit tour, Italian UI on the Italian library', async () => {
  test.skip(!ENABLED, 'design audit: set RL_DESIGN_AUDIT=1');
  test.setTimeout(30 * 60_000);
  await runTour('it', true);
});

test('design audit tour, English UI on the English library', async () => {
  test.skip(!ENABLED, 'design audit: set RL_DESIGN_AUDIT=1');
  test.setTimeout(20 * 60_000);
  await runTour('en', process.env.RL_DESIGN_AUDIT_FULL_EN === '1');
});
