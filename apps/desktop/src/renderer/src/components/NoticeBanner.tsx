import { useCallback, useEffect, useState } from 'react';
import type { AppNotice } from '@rl/core';
import { rl } from '../lib/rl';
import { Lazy, lazyView } from './Lazy';

// The banners themselves are only drawn (and their code loaded) when the main process reported something.
const NoticeStack = lazyView(() => import('./NoticeStack').then((m) => ({ default: m.NoticeStack })), []);

/**
 * Startup notices from the main process (settings file reset, settings from a newer version).
 * They are pulled once on mount (the event may have fired before this component existed) and
 * also arrive as `app:notice` events; both paths are de-duplicated by id.
 */
export function NoticeBanner() {
  const [notices, setNotices] = useState<AppNotice[]>([]);

  const add = useCallback((incoming: AppNotice[]) => {
    setNotices((cur) => [...cur, ...incoming.filter((n) => !cur.some((c) => c.id === n.id))]);
  }, []);

  useEffect(() => {
    let alive = true;
    rl.invoke('app:notices', {}).then(
      (r) => alive && add(r.notices),
      () => {},
    );
    const off = rl.on('app:notice', (n) => add([n]));
    return () => {
      alive = false;
      off();
    };
  }, [add]);

  const dismiss = (id: string) => {
    setNotices((cur) => cur.filter((n) => n.id !== id));
    rl.invoke('app:dismissNotice', { id }).catch(() => {});
  };

  if (notices.length === 0) return null;
  return (
    <Lazy>
      <NoticeStack notices={notices} onDismiss={dismiss} />
    </Lazy>
  );
}
