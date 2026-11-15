import type { Channels, ChannelName, HandlerMap, Logger, EventName, Events } from '@rl/core';
import type { z } from 'zod';

type InDomain<D extends string> = Extract<ChannelName, `${D}:${string}`>;

/** Handlers of one IPC domain, fully typed from the registry (e.g. `DomainHandlers<'settings'>`). */
export type DomainHandlers<D extends string> = HandlerMap<Pick<Channels, InDomain<D>>>;

export type EmitFn = <K extends EventName>(event: K, payload: z.input<Events[K]>) => void;

export interface HandlerDeps {
  log: Logger;
  emit: EmitFn;
}
