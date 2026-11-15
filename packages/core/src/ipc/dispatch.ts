import { z } from 'zod';
import { AppError, serializedErrorSchema, type SerializedError } from '../errors.js';
import type { Logger } from '../log.js';
import type { ChannelRegistry } from './registry.js';

/** What actually crosses the process boundary for each invoke. */
export type IpcEnvelope = { ok: true; data: unknown } | { ok: false; error: SerializedError };

export const ipcEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: serializedErrorSchema }),
]);

export interface HandlerContext {
  /** Origin check already done by the transport. */
  log: Logger;
}

export type HandlerMap<R extends ChannelRegistry> = {
  [K in keyof R]: (payload: z.output<R[K]['request']>, ctx: HandlerContext) => Promise<z.input<R[K]['response']>> | z.input<R[K]['response']>;
};

function issuesOf(error: z.ZodError): Record<string, unknown> {
  return { issues: error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

/**
 * Transport-agnostic core of the IPC main side: validates the request, runs the handler,
 * validates the response, and maps every failure to a serialisable AppError.
 * Never leaks stack traces or non-AppError messages to the renderer.
 */
export function createDispatcher<R extends ChannelRegistry>(registry: R, handlers: Partial<HandlerMap<R>>, log: Logger) {
  return async function dispatch(channel: unknown, payload: unknown): Promise<IpcEnvelope> {
    try {
      if (typeof channel !== 'string' || !Object.hasOwn(registry, channel)) {
        throw new AppError('UNKNOWN_CHANNEL', 'Unknown channel');
      }
      const def = registry[channel]!;
      const handler = (handlers as Record<string, ((p: unknown, c: HandlerContext) => unknown) | undefined>)[channel];
      if (!handler) throw new AppError('NOT_IMPLEMENTED', `No handler for ${channel}`);

      const req = def.request.safeParse(payload);
      if (!req.success) throw new AppError('INVALID_REQUEST', `Invalid request for ${channel}`, issuesOf(req.error));

      const result = await handler(req.data, { log: log.child(channel) });

      const res = def.response.safeParse(result);
      if (!res.success) {
        log.error('invalid handler response', { channel, issues: issuesOf(res.error).issues });
        throw new AppError('INVALID_RESPONSE', `Invalid response from ${channel}`);
      }
      return { ok: true, data: res.data };
    } catch (e) {
      if (e instanceof AppError) return { ok: false, error: e.toJSON() };
      log.error('unhandled handler error', { channel: typeof channel === 'string' ? channel : '?', error: e });
      return { ok: false, error: new AppError('INTERNAL', 'Internal error').toJSON() };
    }
  };
}

/** Renderer side: turn an envelope back into a value or a thrown AppError. */
export function unwrapEnvelope(raw: unknown): unknown {
  const env = ipcEnvelopeSchema.safeParse(raw);
  if (!env.success) throw new AppError('INVALID_RESPONSE', 'Malformed IPC envelope');
  if (env.data.ok) return env.data.data;
  throw AppError.from(env.data.error);
}
