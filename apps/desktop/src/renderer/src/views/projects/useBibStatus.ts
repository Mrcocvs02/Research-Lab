import { useEffect, useState } from 'react';
import type { Channels, ResponseOf } from '@rl/core';
import { useChangeVersion } from '../../lib/events';
import { rl } from '../../lib/rl';

export type BibStatus = ResponseOf<Channels, 'bib:link'>;

/** State of the project's linked .bib file (null until known); read again when a project changes. */
export function useBibStatus(projectId: string): BibStatus | null {
  const version = useChangeVersion('projects');
  const [status, setStatus] = useState<BibStatus | null>(null);
  useEffect(() => {
    let live = true;
    rl.invoke('bib:link', { projectId, op: 'status' }).then(
      (s) => live && setStatus(s),
      () => live && setStatus(null),
    );
    return () => {
      live = false;
    };
  }, [projectId, version]);
  return status;
}
