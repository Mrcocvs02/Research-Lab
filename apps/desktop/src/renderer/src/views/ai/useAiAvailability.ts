import { useEffect, useState } from 'react';
import type { Channels, ResponseOf } from '@rl/core';
import { rl } from '../../lib/rl';

/** Why the AI cannot be used now, in the keys of `chat.unavailable`; 'no-folders' when no folder is enabled for it. */
export type UnavailableReason = 'no-access' | 'offline' | 'cap-reached' | 'error' | 'no-folders';

export function reasonOf(status: ResponseOf<Channels, 'ai:status'>): UnavailableReason | null {
  if (!status.available) return status.reason ?? 'error';
  return status.enabledFolders.length === 0 ? 'no-folders' : null;
}

/**
 * Asks `ai:status` once when the component mounts (no token is spent, nothing is sent). `loading` while it runs;
 * `reason` is null when the AI can be used. A failure of the question itself reads as 'error'.
 */
export function useAiAvailability(): { loading: boolean; reason: UnavailableReason | null } {
  const [state, setState] = useState<{ loading: boolean; reason: UnavailableReason | null }>({ loading: true, reason: null });
  useEffect(() => {
    let live = true;
    rl.invoke('ai:status', {}).then(
      (s) => live && setState({ loading: false, reason: reasonOf(s) }),
      () => live && setState({ loading: false, reason: 'error' }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
