import type { TFunction } from 'i18next';
import type { MenuItem } from '../../../../components/Menu';
import { setDiscoverIntent } from '../../../../lib/discoverIntent';

/** "Trova un ponte" of the selection bar's menu: always listed, active with exactly two documents, else it says why (D-412, D-420). */
export function bridgeItem(t: TFunction, ids: readonly string[], go: () => void): MenuItem {
  const base = { id: 'bridge', testId: 'selection-bridge', label: t('library.selBridge') };
  if (ids.length !== 2) return { ...base, disabled: true, disabledReason: t('library.selBridgeNeeds'), onSelect: () => {} };
  return {
    ...base,
    onSelect: () => {
      setDiscoverIntent({ kind: 'bridge', docIds: [...ids] });
      go();
    },
  };
}
