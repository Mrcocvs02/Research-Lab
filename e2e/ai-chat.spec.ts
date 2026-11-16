import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { asArray, createLibraryViaWizard, idOf, ipc, ipcData, pathOf, waitForScan } from './helpers/phase1';

/**
 * Phase 4, wave 4.1: the AI layer through the real channels with the mock provider (`RL_AI_PROVIDER=mock`, no call to
 * Claude): the streamed events in order, the folder gate, persistence across a restart, the AI-send log, and the original
 * files byte-identical at the end.
 */

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const MOCK = { RL_AI_PROVIDER: 'mock' };

interface ChatEventPayload {
  conversationId: string;
  turnId: string;
  event: { type: string; text?: string; card?: { name: string; status: string }; code?: string };
}

async function listen(window: Page): Promise<void> {
  await window.evaluate(() => {
    const w = window as unknown as { __chat: unknown[]; rlBridge: { subscribe(e: string, l: (p: unknown) => void): () => void } };
    w.__chat = [];
    w.rlBridge.subscribe('chat:event', (p) => w.__chat.push(p));
  });
}
const received = (window: Page) => window.evaluate(() => (window as unknown as { __chat: ChatEventPayload[] }).__chat);

async function docIds(window: Page, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const it of asArray(await ipcData(window, 'documents:list', { limit: 200 }))) {
    const p = pathOf(it);
    const id = idOf(it);
    if (p && id && paths.includes(p)) out.set(p, id);
  }
  return out;
}

test('chat with the mock provider: stream, gate, log, persistence, untouched originals', async () => {
  test.setTimeout(300_000);
  let ctx1: LaunchedApp | undefined;
  let ctx2: LaunchedApp | undefined;
  try {
    ctx1 = await launchApp({ library: 'full', dialogPath: true, offline: true, env: MOCK });
    const { window } = ctx1;
    const manifest = ctx1.library!.manifest!;
    const root = ctx1.library!.root;
    const allowedRel = 'papers/paper-01.pdf';
    const closedRel = 'Area A/Subtopic 2/another-nested.pdf';
    expect(manifest.files.some((f) => f.relPath === allowedRel) && manifest.files.some((f) => f.relPath === closedRel)).toBe(true);

    await createLibraryViaWizard(window, { name: 'AI library' });
    await waitForScan(window, manifest.files.length);
    await expect(window.getByTestId('scan-status')).toHaveAttribute('data-state', 'done', { timeout: 180_000 });
    const ids = await docIds(window, [allowedRel, closedRel]);
    const allowed = ids.get(allowedRel)!;
    const closed = ids.get(closedRel)!;
    expect(allowed && closed).toBeTruthy();
    const hashBefore = sha(await readFile(path.join(root, allowedRel)));

    // Nothing is enabled yet: nothing may go.
    expect((await ipcData<{ enabledFolders: string[] }>(window, 'ai:status')).enabledFolders).toEqual([]);
    expect((await ipc(window, 'chat:send', { text: 'Summarize this paper', model: 'claude-haiku-5-5', reasoning: 'low', contextDocIds: [allowed] })).error?.code).toBe('FOLDER_NOT_AI_ENABLED');

    await ipcData(window, 'library:setConfig', { patch: { aiEnabledFolders: ['papers'], ai: { confirmBeforeSend: false } } });
    const status = await ipcData<{ provider: string; available: boolean; enabledFolders: string[] }>(window, 'ai:status');
    expect(status).toMatchObject({ provider: 'mock', available: true, enabledFolders: ['papers'] });

    const preview = await ipcData<{ allowed: string[]; refused: Array<{ docId: string; reason: string }> }>(window, 'ai:preview', {
      purpose: 'chat', model: 'claude-haiku-5-5', docIds: [allowed, closed], promptChars: 100,
    });
    expect(preview.allowed).toEqual([allowed]);
    expect(preview.refused).toEqual([{ docId: closed, reason: 'folder-not-enabled' }]);

    // A document outside the enabled folders is refused, with nothing started.
    await listen(window);
    const refusal = await ipc(window, 'chat:send', { text: 'Summarize this paper', model: 'claude-haiku-5-5', reasoning: 'low', contextDocIds: [closed] });
    expect(refusal.error?.code).toBe('FOLDER_NOT_AI_ENABLED');
    expect(await received(window)).toEqual([]);

    // The turn: events in order, a real link in the text, a card that ends done.
    const sent = await ipcData<{ conversationId: string; turnId: string }>(window, 'chat:send', {
      text: 'Summarize this paper', model: 'claude-haiku-5-5', reasoning: 'low', contextDocIds: [allowed],
    });
    await expect.poll(async () => (await received(window)).some((e) => e.event.type === 'done' || e.event.type === 'error'), { timeout: 60_000 }).toBe(true);
    const events = (await received(window)).filter((e) => e.turnId === sent.turnId);
    const types = events.map((e) => e.event.type);
    expect(types.at(-1)).toBe('done');
    expect(types.indexOf('text-delta')).toBe(0);
    expect(types.indexOf('card')).toBeGreaterThan(types.indexOf('text-delta'));
    expect(types.lastIndexOf('usage')).toBeGreaterThan(types.lastIndexOf('card'));
    expect(types.indexOf('done')).toBe(types.length - 1);
    const cards = events.filter((e) => e.event.type === 'card').map((e) => e.event.card!);
    expect(cards.at(-1)).toMatchObject({ name: 'search_library', status: 'done' });
    const text = events.filter((e) => e.event.type === 'text-delta').map((e) => e.event.text).join('');
    expect(text).toContain(`lab://doc/${allowed}?page=1`);

    const conv = await ipcData<{ title: string; turns: Array<{ role: string; text: string }> }>(window, 'chat:get', { conversationId: sent.conversationId });
    expect(conv.title).toContain('Summarize this paper');
    expect(conv.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(conv.turns[1]!.text).toBe(text);

    const log = await ipcData<{ items: Array<{ purpose: string; docIds: string[]; folders: string[] }> }>(window, 'ai:log', {});
    expect(log.items.length).toBeGreaterThanOrEqual(1);
    expect(log.items.find((i) => i.purpose === 'chat')).toMatchObject({ docIds: [allowed], folders: ['papers'] });
    expect((await ipcData<{ sends: number }>(window, 'ai:usage', {})).sends).toBe(1);

    // ---- restart on the same data
    await ctx1.app.close();
    ctx2 = await launchApp({ offline: true, env: { ...MOCK, RL_USER_DATA_DIR: ctx1.userDataDir, RL_LOCAL_DATA_DIR: ctx1.localDataDir } });
    const w2 = ctx2.window;
    await expect.poll(async () => (await ipc(w2, 'chat:list', {})).ok, { timeout: 60_000, intervals: [250, 500, 1000] }).toBe(true);
    const list = await ipcData<{ items: Array<{ id: string; title: string; turns: number }> }>(w2, 'chat:list', {});
    expect(list.items).toEqual([expect.objectContaining({ id: sent.conversationId, turns: 2 })]);
    const again = await ipcData<{ turns: Array<{ text: string }> }>(w2, 'chat:get', { conversationId: sent.conversationId });
    expect(again.turns[1]!.text).toBe(text);
    expect((await ipcData<{ items: unknown[] }>(w2, 'ai:log', {})).items.length).toBeGreaterThanOrEqual(1);
    expect((await ipcData<{ enabledFolders: string[] }>(w2, 'ai:status')).enabledFolders).toEqual(['papers']);
    expect(await ipcData(w2, 'chat:delete', { conversationId: sent.conversationId })).toEqual({ deleted: true });
    expect((await ipcData<{ items: unknown[] }>(w2, 'chat:list', {})).items).toEqual([]);

    // ---- the originals are byte-identical
    expect(sha(await readFile(path.join(root, allowedRel)))).toBe(hashBefore);
    await ctx1.verifyLibraryUntouched();
  } finally {
    await ctx2?.close().catch(() => {});
    await ctx1?.close().catch(() => {});
  }
});
