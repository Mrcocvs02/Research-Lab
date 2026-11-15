import { useCallback, useEffect, useState } from 'react';
import type { ScanStatus } from '@rl/core';
import { rl } from '../../lib/rl';
import { useApp } from '../../state/app-context';

/** Status of the background scan of the active library (pushed by `scan:progress`), plus the controls. */
export function useScanStatus() {
  const { activeLibraryId } = useApp();
  const [status, setStatus] = useState<ScanStatus | null>(null);

  useEffect(() => {
    setStatus(null);
    if (!activeLibraryId) return;
    let alive = true;
    const off = rl.on('scan:progress', (s) => {
      if (alive && s.libraryId === activeLibraryId) setStatus(s);
    });
    rl.invoke('scan:status', {}).then(
      (s) => alive && setStatus((cur) => cur ?? s),
      () => {},
    );
    return () => {
      alive = false;
      off();
    };
  }, [activeLibraryId]);

  const start = useCallback(async (full = false) => {
    setStatus(await rl.invoke('scan:start', { full }));
  }, []);
  const cancel = useCallback(async () => {
    setStatus(await rl.invoke('scan:cancel', {}));
  }, []);
  const rebuild = useCallback(async () => {
    setStatus(await rl.invoke('index:rebuild', {}));
  }, []);
  return { status, start, cancel, rebuild };
}
