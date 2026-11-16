import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '@rl/core';
import { createClaudeProvider } from './claude.js';

/** Live smoke test: one tiny question to the real Claude. Skipped unless RL_LIVE_AI=1 (never part of the automatic runs). */
describe.skipIf(process.env.RL_LIVE_AI !== '1')('live Claude (RL_LIVE_AI=1)', () => {
  it('answers a one-word question through the Agent SDK', async () => {
    const provider = createClaudeProvider({ workDir: path.join(os.tmpdir(), 'rl-live-ai') });
    expect(await provider.isAvailable()).toBe(true);
    const events: ChatEvent[] = [];
    for await (const e of provider.chat({ model: 'claude-haiku-5-5', reasoning: 'low', system: 'Answer in one word.', messages: [{ role: 'user', content: 'Say OK.' }] })) events.push(e);
    expect(events.at(-1)?.type).toBe('done');
  }, 120_000);
});
