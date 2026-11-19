import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData } from './helpers/phase1';

/**
 * Hostile document content must stay inert text in the renderer (D-080): markup in titles, authors and body,
 * wikilink brackets, bidi overrides and control characters. A synthetic library of markdown files whose titles
 * and bodies are attack strings is scanned, then searched; results are checked in the real DOM.
 */

const PAYLOAD = '<img src=x onerror="window.__pwned=1">';
const SCRIPT = '<script>window.__pwned=2</script>';
const RLO = '\u202E';

const files: Record<string, string> = {
  'one.md': [
    '---',
    `title: ${PAYLOAD} quasarium ${RLO}gnp.exe`,
    'authors: <b>Mallory</b>, [[Eve]]',
    '---',
    '',
    `The word quasarium appears with ${SCRIPT} and [[quasarium]] and ]] and [[ here.`,
    `Forged markers \u0001quasarium\u0002 and a bidi ${RLO}override inside the body plus \u0007 bell.`,
  ].join('\n'),
  'two.md': ['# Notes on [[wikilink]] syntax ]] with <iframe src="javascript:window.__pwned=3"></iframe>', '', 'A body about wikilink and [[other words]] only.'].join('\n'),
};

async function launchHostile() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rl-sec-'));
  await mkdir(path.join(root, 'docs'), { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, 'docs', name), text, 'utf8');
  const ctx = await launchApp({ dialogPath: root, offline: true });
  return { ctx, root };
}

async function search(window: Page, text: string): Promise<void> {
  const input = window.getByTestId('search-input');
  await input.fill(text);
  const pane = window.getByTestId('results-pane');
  await expect(pane).toHaveAttribute('data-query', text, { timeout: 30_000 });
  await expect(pane).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
  await expect(window.getByTestId('search-result').first()).toBeVisible({ timeout: 30_000 });
}

test('hostile titles, authors, snippets and cards are rendered as inert text', async () => {
  test.setTimeout(240_000);
  const { ctx, root } = await launchHostile();
  try {
    const { window } = ctx;
    const dialogs: string[] = [];
    const errors: string[] = [];
    window.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    window.on('pageerror', (e) => errors.push(String(e)));
    window.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await createLibraryViaWizard(window, { name: 'Hostile library' });
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });

    const pane = window.getByTestId('results-pane');
    const inert = async () => {
      // Nothing the documents contain became an element.
      // The only SVGs allowed are the app's own static glyphs: the file-type glyph and the "More actions" dots of the row (no text, scripts or foreign objects inside).
      await expect(pane.locator('img, script, iframe, b, style, a, svg:not(.type-icon > svg, [data-testid="row-more"] > svg)')).toHaveCount(0);
      await expect(pane.locator('.type-icon > svg :is(script, foreignObject, text, a), [data-testid="row-more"] > svg :not(circle)')).toHaveCount(0);
      expect(await window.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned)).toBeUndefined();
      expect(await window.locator('img[src="x"], iframe[src^="javascript:"]').count()).toBe(0);
      expect(dialogs).toEqual([]);
    };

    // 1. The attack word is in title, authors and body: the title shows the payload as text.
    await search(window, 'quasarium');
    const card = window.getByTestId('search-result').filter({ hasText: 'quasarium' }).first();
    await expect(card.getByTestId('result-title')).toContainText('<img src=x onerror="window.__pwned=1">');
    await expect(card).toContainText('<b>Mallory</b>');
    await inert();
    // Highlights are exactly the searched term: never the forged markers or brackets of the text.
    const marked = await pane.locator('mark').allTextContents();
    expect(marked.length).toBeGreaterThan(0);
    for (const m of marked) expect(m.toLowerCase()).toBe('quasarium');
    // Bidi overrides and control characters never reach the DOM text.
    const shown = (await pane.textContent()) ?? '';
    expect(shown).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    // The brackets of the text are still shown, as plain text.
    expect(shown).toContain('[[');

    // 2. A field made of brackets is not a match: the second document is found by its real word, not by "[[".
    await search(window, 'wikilink');
    const wiki = window.getByTestId('search-result').filter({ hasText: 'Notes on' }).first();
    await expect(wiki.getByTestId('result-title')).toContainText('[[wikilink]]');
    await expect(wiki.getByTestId('result-title')).toContainText('<iframe');
    await inert();
    for (const m of await pane.locator('mark').allTextContents()) expect(m.toLowerCase()).toBe('wikilink');
    // The words of a "[[other words]]" link only match when searched, and are marked as exactly those words.
    await search(window, 'other words');
    for (const m of await pane.locator('mark').allTextContents()) expect(['other', 'words']).toContain(m.toLowerCase());
    await inert();

    // 3. Searching the brackets themselves finds nothing and marks nothing.
    await window.getByTestId('search-input').fill('[[');
    await expect(window.getByTestId('search-empty')).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId('search-error')).toHaveCount(0);

    // 4. The document record reaches the renderer without `legacy` and without absolute paths.
    const hits = await ipcData<{ hits: Array<{ docId: string }> }>(window, 'search:query', { text: 'quasarium' });
    const record = await ipcData<Record<string, unknown>>(window, 'documents:get', { docId: hits.hits[0]!.docId });
    expect(record).not.toHaveProperty('legacy');
    expect(JSON.stringify(record)).not.toContain(path.basename(root));

    expect(dialogs).toEqual([]);
    expect(errors.filter((e) => /pwned|onerror|javascript:|not defined/i.test(e))).toEqual([]);
    expect(await ctx.blockedRequests()).toEqual([]);
  } finally {
    await ctx.close();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
