import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { createMemoryLogger } from '../log.js';
import { channels, events } from './channels/index.js';
import { createDispatcher, unwrapEnvelope, type HandlerMap } from './dispatch.js';
import { defineChannels, mergeRegistries } from './registry.js';

describe('channel registry', () => {
  it('has the phase-0 channels, domain-prefixed', () => {
    for (const name of [
      'settings:get',
      'settings:set',
      'library:create',
      'library:list',
      'library:setActive',
      'dialog:chooseFolder',
      'import:startLegacy',
      'import:status',
      'secrets:set',
      'secrets:has',
      'secrets:delete',
    ]) {
      expect(Object.keys(channels)).toContain(name);
    }
    expect(Object.keys(events)).toContain('import:progress');
  });

  it('never exposes a way to read a secret', () => {
    expect(Object.keys(channels).filter((k) => k.startsWith('secrets:'))).toEqual(['secrets:set', 'secrets:has', 'secrets:delete']);
    const hasShape = channels['secrets:has'].response.parse({ exists: true });
    expect(hasShape).toEqual({ exists: true });
    expect(() => channels['secrets:has'].response.parse({ exists: true, value: 'x' })).not.toThrow(); // stripped
    expect(channels['secrets:has'].response.parse({ exists: true, value: 'x' })).toEqual({ exists: true });
  });

  it('detects duplicate keys when merging', () => {
    const a = defineChannels('x', { y: { request: z.object({}), response: z.object({}) } });
    expect(() => mergeRegistries(a, a)).toThrow(/Duplicate/);
  });
});

describe('dispatcher', () => {
  const reg = defineChannels('t', {
    echo: { request: z.object({ n: z.number().int() }), response: z.object({ n: z.number() }) },
    bad: { request: z.object({}), response: z.object({ n: z.number() }) },
    boom: { request: z.object({}), response: z.object({}) },
    app: { request: z.object({}), response: z.object({}) },
    missing: { request: z.object({}), response: z.object({}) },
  });
  const handlers: Partial<HandlerMap<typeof reg>> = {
    't:echo': ({ n }) => ({ n: n + 1 }),
    't:bad': () => ({ n: 'nope' }) as never,
    't:boom': () => {
      throw new Error('secret stack detail C:\\Users\\x');
    },
    't:app': () => {
      throw new AppError('NOT_FOUND', 'nope');
    },
  };
  const log = createMemoryLogger();
  const dispatch = createDispatcher(reg, handlers, log);

  it('passes valid requests and validates the response', async () => {
    expect(await dispatch('t:echo', { n: 1 })).toEqual({ ok: true, data: { n: 2 } });
  });

  it('rejects invalid requests', async () => {
    const r = await dispatch('t:echo', { n: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects unknown channels, including prototype keys', async () => {
    for (const c of ['nope', 'toString', '__proto__', 42]) {
      const r = await dispatch(c, {});
      expect(r.ok === false && r.error.code).toBe('UNKNOWN_CHANNEL');
    }
  });

  it('rejects invalid responses without leaking them', async () => {
    const r = await dispatch('t:bad', {});
    expect(r.ok === false && r.error.code).toBe('INVALID_RESPONSE');
  });

  it('hides internal error details from the renderer', async () => {
    const r = await dispatch('t:boom', {});
    expect(r).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Internal error' } });
  });

  it('keeps AppError codes and reports missing handlers', async () => {
    expect((await dispatch('t:app', {})).ok).toBe(false);
    const r = await dispatch('t:missing', {});
    expect(r.ok === false && r.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('unwrap throws AppError with the code', () => {
    expect(unwrapEnvelope({ ok: true, data: 5 })).toBe(5);
    try {
      unwrapEnvelope({ ok: false, error: { code: 'NOT_FOUND', message: 'x' } });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
    expect(() => unwrapEnvelope('garbage')).toThrow(AppError);
  });
});

describe('phase-0 request schemas', () => {
  it('library:create refuses path-like data dir names', () => {
    const s = channels['library:create'].request;
    expect(s.safeParse({ name: 'L', rootPath: 'X:\\l', dataDirName: '../x' }).success).toBe(false);
    expect(s.safeParse({ name: 'L', rootPath: 'X:\\l' }).success).toBe(true);
  });
  it('secrets names are constrained', () => {
    const s = channels['secrets:set'].request;
    expect(s.safeParse({ scope: { kind: 'app' }, name: 'anthropic.api-key', value: 'v' }).success).toBe(true);
    expect(s.safeParse({ scope: { kind: 'app' }, name: '../x', value: 'v' }).success).toBe(false);
  });
});
