import type { TFunction } from 'i18next';
import { COMPARE_LIMITS } from '@rl/core';
import type { MenuItem } from '../../../../components/Menu';

/** "Tabella di confronto…" of the ✦ Claude menu: always listed, active with 2 to 30 papers, else it says why (D-412). */
export function compareItem(t: TFunction, ids: readonly string[], open: () => void): MenuItem {
  const base = { id: 'compare', testId: 'selection-compare', label: t('library.selCompare') };
  if (ids.length < 2 || ids.length > COMPARE_LIMITS.docs) return { ...base, disabled: true, disabledReason: t('library.selCompareNeeds', { max: COMPARE_LIMITS.docs }), onSelect: () => {} };
  return { ...base, onSelect: open };
}
