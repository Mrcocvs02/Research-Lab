import { describe, expect, it } from 'vitest';
import { channels, events } from './channels/index.js';
import { CHANNEL_NAMES, EVENT_NAMES } from './names.js';

describe('plain IPC name lists (used by the preload)', () => {
  it('list exactly the channels and events of the registry', () => {
    expect([...CHANNEL_NAMES].sort()).toEqual(Object.keys(channels).sort());
    expect([...EVENT_NAMES].sort()).toEqual(Object.keys(events).sort());
  });
});
