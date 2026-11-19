import { expect, test, type Page } from '@playwright/test';
import { type LaunchedApp } from './helpers/launch';
import { skipUnlessChannels } from './helpers/phase1';
import { openSyntheticLibrary } from './helpers/ui';

/**
 * X5 (features 3, 29, 30), by property: two papers side by side keep ONE bar and one focus; below 1280 px the second
 * paper is a tab; citation cards and the guide leave no trace at rest or with the experiment off.
 */
const CHANNELS = ['reader:open', 'refs:get', 'guides:get'];

test.describe.serial('side by side, citation cards, guide (X5)', () => {
  let ctx: LaunchedApp;
  let window: Page;

  async function setWidth(width: number): Promise<void> {
    const cdp = await window.context().newCDPSession(window);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await expect.poll(() => window.evaluate(() => innerWidth)).toBe(width);
  }

  test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(300_000);
    const opened = await openSyntheticLibrary(testInfo, 'papers');
    ctx = opened.ctx;
    window = opened.window;
    await skipUnlessChannels(window, testInfo, CHANNELS);
  });
  test.afterAll(async () => ctx?.close());

  test('the library offers "read side by side" only for exactly two documents', async () => {
    const rows = window.getByTestId('search-result');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    await window.getByTestId('selection-more').click();
    await expect(window.getByTestId('selection-side-by-side')).toBeEnabled();
    await window.keyboard.press('Escape');
    await rows.nth(2).click({ modifiers: ['Control'] });
    await window.getByTestId('selection-more').click();
    await expect(window.getByTestId('selection-side-by-side')).toBeDisabled();
    await window.keyboard.press('Escape');
  });

  test('two papers: one bar, a divider, tabs below 1280 px', async () => {
    test.setTimeout(240_000);
    await setWidth(1440);
    const rows = window.getByTestId('search-result');
    await rows.nth(2).click({ modifiers: ['Control'] });
    await window.getByTestId('selection-more').click();
    await window.getByTestId('selection-side-by-side').click();
    await expect(window.getByTestId('reader-split')).toBeVisible({ timeout: 60_000 });
    await expect(window.getByTestId('reader-more')).toHaveCount(1);
    await expect(window.getByTestId('reader-split-divider')).toBeVisible();
    await setWidth(1100);
    await expect(window.getByTestId('reader-split-tabs')).toBeVisible();
    await window.getByTestId('reader-split-tab-1').click();
    await expect(window.getByTestId('reader-split').locator('[data-side="1"]')).not.toHaveAttribute('data-hidden');
    await setWidth(1440);
  });

  test('no citation card and no guide trace at rest', async () => {
    await expect(window.getByTestId('citation-card')).toHaveCount(0);
    await expect(window.getByTestId('guide-host')).toHaveCount(0);
    await expect(window.getByTestId('reader-guide')).toHaveCount(0);
  });
});
