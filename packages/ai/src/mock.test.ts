import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatEvent, ChatRequest } from '@rl/core';
import { createMockAiProvider } from './mock.js';

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({ model: 'claude-haiku-5-5', reasoning: 'low', system: 'sys', messages: [{ role: 'user', content: 'hello there' }], ...over });
const collect = async (it: AsyncIterable<ChatEvent>) => {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

describe('mock provider', () => {
  it('streams text deltas, then usage, then done, deterministically', async () => {
    const p = createMockAiProvider({ now: () => new Date('2026-01-01T00:00:00Z') });
    const a = await collect(p.chat(req()));
    const b = await collect(p.chat(req()));
    expect(a).toEqual(b);
    expect(a.map((e) => e.type)).toEqual([...Array(a.length - 2).fill('text-delta'), 'usage', 'done']);
    expect(a.filter((e): e is Extract<ChatEvent, { type: 'text-delta' }> => e.type === 'text-delta').map((e) => e.text).join('')).toBe('Mock reply to: hello there');
    expect(a.at(-1)).toMatchObject({ meta: { provider: 'mock', model: 'claude-haiku-5-5', source: 'chat', date: '2026-01-01T00:00:00.000Z' } });
  });

  it('runs scripted and directive tool calls through the real tool specs', async () => {
    const p = createMockAiProvider({ reply: 'ok', chunks: 1 });
    const tools = [
      { name: 'echo', description: '', input: z.object({ a: z.number() }), writes: false, run: async (i: unknown) => ({ summary: `echo ${(i as { a: number }).a}`, docIds: [], data: {} }) },
      { name: 'boom', description: '', input: z.object({}), writes: false, run: async () => { throw Object.assign(new Error('nope'), { code: 'X' }); } },
    ];
    const ev = await collect(p.chat(req({ tools, messages: [{ role: 'user', content: 'go\n@tool echo {"a":3}\n@tool boom {}\n@tool missing {}' }] })));
    expect(ev.filter((e) => e.type === 'tool-result')).toEqual([
      { type: 'tool-result', id: 'mock-tool-1', name: 'echo', ok: true, summary: 'echo 3' },
      { type: 'tool-result', id: 'mock-tool-2', name: 'boom', ok: false, summary: expect.stringContaining('nope') },
      { type: 'tool-result', id: 'mock-tool-3', name: 'missing', ok: false, summary: 'Unknown tool missing' },
    ]);
    expect(ev.map((e) => e.type).slice(0, 2)).toEqual(['tool-call', 'tool-result']);
  });

  it('stops with CANCELLED when aborted, even while holding', async () => {
    const ac = new AbortController();
    const p = createMockAiProvider({ holdUntilAborted: true, reply: 'part', chunks: 1 });
    const out: ChatEvent[] = [];
    for await (const e of p.chat(req({ signal: ac.signal }))) {
      out.push(e);
      if (e.type === 'text-delta') ac.abort();
    }
    expect(out.map((e) => e.type)).toEqual(['text-delta', 'error']);
    expect(out.at(-1)).toMatchObject({ code: 'CANCELLED' });
  });

  it('can fail, report no access and answer structured requests', async () => {
    const f = createMockAiProvider({ fail: { code: 'AI_PROVIDER_ERROR', message: 'down' } });
    expect((await collect(f.chat(req()))).at(-1)).toMatchObject({ type: 'error', message: 'down' });
    const n = createMockAiProvider({ available: false });
    expect(await n.isAvailable()).toBe(false);
    expect(await n.access()).toEqual({ auth: 'none' });
    const s = createMockAiProvider({ structured: { n: 1 } });
    const r = await s.completeStructured({ model: 'm', reasoning: 'low', system: '', prompt: 'p', schema: z.object({ n: z.number() }), source: 'cmd' });
    expect(r.value).toEqual({ n: 1 });
    await expect(s.completeStructured({ model: 'm', reasoning: 'low', system: '', prompt: 'p', schema: z.object({ n: z.string() }), source: 'cmd' })).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' });
  });
});
