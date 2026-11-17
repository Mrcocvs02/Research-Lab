import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channels, ResponseOf } from '@rl/core';
import { useChangeVersion } from '../../lib/events';
import { rl } from '../../lib/rl';

export type GraphStatus = ResponseOf<Channels, 'graph:status'>;
export type Phase = 'vectors' | 'similarity' | 'clusters' | 'layout';

export interface Building {
  jobId: string | null;
  phase: Phase | null;
  done: number;
  total: number;
}

/**
 * The state of the model: `graph:status` (kept current when documents change), the build job with its progress
 * (`graph:progress`) and `mapVersion`, which moves every time a build ends so the map reloads.
 */
export function useGraphModel() {
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [mapVersion, setMapVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [trimmed, setTrimmed] = useState(0);
  const docsVersion = useChangeVersion('documents');
  const job = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await rl.invoke('graph:status', {});
      setStatus(s);
      setError(null);
      if (s.state === 'building') setBuilding((b) => b ?? { jobId: job.current, phase: null, done: 0, total: 0 });
      else if (job.current === null) setBuilding(null);
      return s;
    } catch (e) {
      setError(e);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, docsVersion]);

  useEffect(
    () =>
      rl.on('graph:progress', (e) => {
        // Another build (not ours) may be the one running: follow it.
        if (job.current === null || job.current === e.jobId) {
          if (e.phase === 'done' || e.phase === 'failed' || e.phase === 'cancelled') {
            job.current = null;
            setBuilding(null);
            setFailed(e.phase === 'failed');
            setFailReason(e.phase === 'failed' ? (e.reason ?? null) : null);
            setTrimmed(e.phase === 'done' ? (e.trimmedCitations ?? 0) : 0);
            void refresh().then(() => setMapVersion((v) => v + 1));
          } else {
            job.current = e.jobId;
            setBuilding({ jobId: e.jobId, phase: e.phase, done: e.done, total: e.total });
          }
        }
      }),
    [refresh],
  );

  const build = useCallback(
    async (seed?: number) => {
      setError(null);
      setFailed(false);
      setFailReason(null);
      setTrimmed(0);
      try {
        const r = await rl.invoke('graph:build', seed !== undefined ? { seed } : {});
        job.current = r.jobId;
        setBuilding((b) => b ?? { jobId: r.jobId, phase: null, done: 0, total: 0 });
      } catch (e) {
        setError(e);
      }
    },
    [],
  );

  const cancel = useCallback(async () => {
    const id = job.current;
    if (id === null) return;
    try {
      await rl.invoke('graph:cancel', { jobId: id });
    } catch (e) {
      setError(e);
    }
  }, []);

  return { status, error, failed, failReason, trimmed, building, mapVersion, build, cancel, refresh, bumpMap: () => setMapVersion((v) => v + 1) };
}
