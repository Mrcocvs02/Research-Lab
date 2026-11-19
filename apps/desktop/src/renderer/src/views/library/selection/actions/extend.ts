import type { TFunction } from 'i18next';
import type { MenuItem } from '../../../../components/Menu';
import { setDiscoverIntent } from '../../../../lib/discoverIntent';

/** "Estendi la bibliografia…" of the selection bar's menu: no ✦, the search needs no Claude (D-413). Starts in Discover. */
export function extendItem(t: TFunction, ids: readonly string[], go: () => void): MenuItem {
  return {
    id: 'extend',
    testId: 'selection-extend',
    label: t('library.selExtend'),
    onSelect: () => {
      setDiscoverIntent({ kind: 'extend', docIds: [...ids] });
      go();
    },
  };
}
