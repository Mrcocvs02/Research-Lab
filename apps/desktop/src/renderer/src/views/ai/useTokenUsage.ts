import { useEffect, useState } from 'react';
import type { AiTokenUsage } from '@rl/core';
import { rl } from '../../lib/rl';

/** The token usage of the month and the cap (D-442): read once, then kept up to date by `ai:usageChanged`. */
export function useTokenUsage(): AiTokenUsage | null {
  const [u, setU] = useState<AiTokenUsage | null>(null);
  useEffect(() => {
    let live = true;
    rl.invoke('ai:tokenUsage', {}).then((v) => live && setU((cur) => cur ?? v), () => {});
    const off = rl.on('ai:usageChanged', ({ crossedWarn: _c, ...v }) => setU(v));
    return () => {
      live = false;
      off();
    };
  }, []);
  return u;
}
