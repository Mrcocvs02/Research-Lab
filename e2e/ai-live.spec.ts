import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, ipcData, skipUnlessChannels, waitForScan } from './helpers/phase1';
import { clickRow } from './helpers/ui';

/**
 * The chat against the real Claude (only with `RL_LIVE_AI=1`, never in the normal suite): the generated fixture library
 * (synthetic text only), one enabled folder, one selected document, the default model (Haiku) and reasoning (low).
 * 1. A question on the selected document: its first pages go with the turn, so the answer needs no tool.
 * 2. A question on the rest of the library: the agent must use the library tools (at least one card).
 * Both turns must stream in and end without error.
 */
test.skip(process.env.RL_LIVE_AI !== '1', 'live AI test: set RL_LIVE_AI=1 (uses the Claude access of this machine)');

const AI_CHANNELS = ['ai:status', 'ai:preview', 'chat:send', 'chat:list', 'chat:get'];
const QUESTION = 'In one sentence, what is this paper about? Cite the page you read with a lab:// link.';
const SEARCH = 'Search the library for other papers on a related topic and list their titles, each with its lab:// link.';

test('live chat: real Claude answers about a selected document using the library tools', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true });
    const window = ctx.window;
    await createLibraryViaWizard(window, { name: 'Live AI library' });
    await skipUnlessChannels(window, testInfo, AI_CHANNELS);
    const files = ctx.library!.manifest!.files;
    await waitForScan(window, files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const file = files.find((f) => f.format === 'pdf' && f.title && f.relPath.startsWith('papers/'));
    test.skip(!file, 'needs a titled PDF in a folder');
    const folder = file!.relPath.split('/')[0]!;

    await window.getByTestId('nav-settings').click();
    await expect(window.getByTestId('ai-available')).toHaveText('Available', { timeout: 30_000 });
    await window.getByTestId('config-ai-tree').locator(`input[data-folder="${folder}"]`).check();
    await window.getByTestId('ai-save').click();
    await expect(window.getByTestId('ai-settings').getByText('Saved')).toBeVisible();

    await window.getByTestId('nav-library').click();
    await window.getByTestId('search-sort').selectOption('title');
    await clickRow(window, file!.title!);
    if (!(await window.getByTestId('chat-content').isVisible())) await window.getByTestId('chat-toggle').click();
    await expect(window.getByTestId('chat-content')).toBeVisible({ timeout: 30_000 });
    await expect(window.getByTestId('ai-unavailable')).toHaveCount(0);

    const ask = async (question: string, index: number) => {
      await window.getByTestId('chat-input').fill(question);
      await window.getByTestId('chat-send').click();
      const preview = window.getByTestId('send-preview');
      await expect(preview.getByTestId('preview-allowed')).toHaveCount(1);
      await preview.getByTestId('preview-confirm').click();
      const answer = window.getByTestId('chat-turn-ai').nth(index);
      await expect(answer).toBeVisible({ timeout: 60_000 });
      await expect(window.getByTestId('chat-cancel')).toHaveCount(0, { timeout: 180_000 });
      const text = await answer.locator('.chat-md').innerText();
      const cards = await answer.getByTestId('chat-card').allInnerTexts();
      const errors = await answer.getByTestId('turn-error').allInnerTexts();
      const usage = (await window.getByTestId('chat-usage').allInnerTexts()).join(' ');
      const chips = await answer.getByTestId('lab-chip').allInnerTexts();
      console.log(`[live ${index + 1}] answer: ${text}\n[live ${index + 1}] cards: ${JSON.stringify(cards)}\n[live ${index + 1}] chips: ${JSON.stringify(chips)}\n[live ${index + 1}] usage: ${usage}`);
      expect(errors).toEqual([]);
      expect(text.trim().length).toBeGreaterThan(0);
      // A chip never repeats the page its own text already names ("p. 1, p. 1").
      for (const c of chips) expect(c).not.toMatch(/p\.\s*(\d+),\s*p\.\s*\1(?!\d)/);
      return cards;
    };
    await ask(QUESTION, 0);
    expect((await ask(SEARCH, 1)).length).toBeGreaterThan(0);
    // The raw Markdown of the answers, for the log (links and chips can be checked against it).
    const list = await ipcData<{ items: { id: string }[] }>(window, 'chat:list', {});
    const conv = await ipcData<{ turns: { role: string; text: string }[] }>(window, 'chat:get', { conversationId: list.items[0]!.id });
    for (const t of conv.turns.filter((x) => x.role === 'assistant')) console.log(`[live raw] ${t.text}`);
  } finally {
    await ctx?.close();
  }
});
