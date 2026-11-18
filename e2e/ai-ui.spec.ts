import { _electron as electron, expect, test } from '@playwright/test';
import { DESKTOP_DIR, launchApp, type LaunchedApp } from './helpers/launch';
import { createLibraryViaWizard, skipUnlessChannels, waitForScan } from './helpers/phase1';
import { enableAiFolder, openSettings, waitClaudeReady } from './helpers/settings';
import { clickRow } from './helpers/ui';

/**
 * Phase 4 (wave 4.1) criterion: the AI interface against the mock provider (`RL_AI_PROVIDER=mock`, no network).
 * A folder is enabled in the settings, a document is selected, the chat is opened, the preview is confirmed, an answer
 * streams in with an action card and a `lab://` chip, the chip opens the reader at the page, and after a restart the
 * conversation is in the history.
 */
const AI_CHANNELS = ['ai:status', 'ai:preview', 'ai:usage', 'ai:log', 'chat:send', 'chat:list', 'chat:get', 'commands:list'];
const MOCK = { RL_AI_PROVIDER: 'mock' };
const QUESTION = 'Summarize this paper in one line';

test('enable a folder, preview and confirm, streamed answer with card and chip, restart and history (phase 4)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  let ctx: LaunchedApp | undefined;
  let second: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    ctx = await launchApp({ library: 'papers', dialogPath: true, offline: true, env: MOCK });
    let window = ctx.window;
    await createLibraryViaWizard(window, { name: 'AI library' });
    await skipUnlessChannels(window, testInfo, AI_CHANNELS);
    const files = ctx.library!.manifest!.files;
    await waitForScan(window, files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const file = files.find((f) => f.format === 'pdf' && f.title && f.relPath.startsWith('papers/'));
    test.skip(!file, 'needs a titled PDF in a folder');
    const title = file!.title!;
    const folder = file!.relPath.split('/')[0]!;

    // No AI code is loaded before the chat is first opened, and nothing may be sent yet.
    await expect(window.getByTestId('chat-content')).toHaveCount(0);
    await expect(window.getByTestId('status-ai')).toContainText(/no folder|nessuna/i);

    // 1. Enable the folder in the settings (the default is none).
    await waitClaudeReady(window);
    await expect(window.getByTestId('ai-folders-summary')).toContainText('nothing is sent');
    await enableAiFolder(window, folder);
    await expect(window.getByTestId('status-ai')).toContainText('1');

    // 2. Select a document.
    await window.getByTestId('nav-library').click();
    await expect(window.getByTestId('section-library')).toBeVisible();
    await window.getByTestId('search-sort').selectOption('title');
    await clickRow(window, title);
    await expect(window.getByTestId('selection-count')).toBeVisible();

    // 3. Open the chat (button; the shortcut is Ctrl+J). The selection is the context.
    await window.getByTestId('chat-toggle').click();
    await expect(window.getByTestId('chat-content')).toBeVisible({ timeout: 30_000 });
    await expect(window.getByTestId('context-chip')).toHaveCount(1);
    await expect(window.getByTestId('ai-unavailable')).toHaveCount(0);

    // 4. Preview, confirm, stream.
    await window.getByTestId('chat-input').fill(QUESTION);
    await window.getByTestId('chat-send').click();
    const preview = window.getByTestId('send-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByTestId('preview-allowed')).toHaveCount(1);
    await expect(preview.getByTestId('preview-refused')).toHaveCount(0);
    await preview.getByTestId('preview-confirm').click();
    await expect(preview).toHaveCount(0);

    const answer = window.getByTestId('chat-turn-ai').first();
    await expect(answer).toBeVisible({ timeout: 30_000 });
    await expect(answer.getByTestId('ai-mark')).toBeVisible();
    await expect(window.getByTestId('chat-cancel')).toHaveCount(0, { timeout: 60_000 }); // the turn ended
    await expect(answer.locator('.chat-md')).not.toBeEmpty();
    await expect(answer.getByTestId('chat-card').first()).toBeVisible();
    await expect(answer.getByTestId('turn-error')).toHaveCount(0);
    // The send is in the log of what went to the AI (settings), and the usage counter is shown.
    await expect(window.getByTestId('chat-usage')).toBeVisible();

    // The chip of the answer opens the reader (at the page it names).
    const chip = answer.locator('[data-testid="lab-chip"][data-kind="doc"]').first();
    await expect(chip).toBeVisible();
    const named = /p\.\s*(\d+)/.exec((await chip.innerText()) ?? '');
    await chip.click();
    await expect(window.getByTestId('reader')).toBeVisible({ timeout: 60_000 });
    await expect(window.getByTestId('reader-error')).toHaveCount(0);
    if (named) await expect(window.getByTestId('reader-page-input')).toHaveValue(named[1]!, { timeout: 60_000 });
    await window.getByTestId('reader-close').click();

    // The log viewer lists the send, with the confirmed document.
    await openSettings(window, 'claude');
    const fold = window.getByTestId('settings-fold-aiLog');
    if ((await fold.getAttribute('open')) === null) await fold.locator('summary').click();
    await expect(window.getByTestId('log-row').first()).toBeVisible({ timeout: 30_000 });

    // 5. Restart on the same data: the conversation is in the history.
    await ctx.app.close();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.ELECTRON_RENDERER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, MOCK, { RL_USER_DATA_DIR: ctx.userDataDir, RL_LOCAL_DATA_DIR: ctx.localDataDir, NODE_ENV: 'production', RL_E2E_HIDDEN: '1' });
    second = await electron.launch({ args: [DESKTOP_DIR], env });
    window = await second.firstWindow();
    await window.getByTestId('search-result').first().waitFor({ state: 'visible', timeout: 60_000 });
    // The panel remembers whether it was left open (`rl.chatOpen`): open it only if it is closed.
    if (!(await window.getByTestId('chat-content').isVisible())) await window.getByTestId('chat-toggle').click();
    await expect(window.getByTestId('chat-content')).toBeVisible({ timeout: 30_000 });
    await window.getByTestId('chat-history-toggle').click();
    const item = window.getByTestId('history-item').first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    await expect(item).toContainText('Summarize this paper');
    await item.getByTestId('history-open').click();
    await expect(window.getByTestId('chat-turn-user').first()).toContainText(QUESTION);
    await expect(window.getByTestId('chat-turn-ai').first().locator('.chat-md')).not.toBeEmpty();
  } finally {
    await second?.close().catch(() => {});
    await ctx?.close();
  }
});
