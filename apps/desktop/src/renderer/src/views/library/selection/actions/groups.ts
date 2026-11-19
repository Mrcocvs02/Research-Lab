import type { TFunction } from 'i18next';
import { GROUPS_LIMITS } from '@rl/core';
import type { MenuItem } from '../../../../components/Menu';

/** "Panoramica dei gruppi di ricerca…" of the ✦ Claude menu: active with 1 to 30 papers, else it says why. */
export function groupsItem(t: TFunction, ids: readonly string[], open: () => void): MenuItem {
  const base = { id: 'groups', testId: 'selection-groups', label: t('library.selGroups') };
  if (ids.length > GROUPS_LIMITS.docs) return { ...base, disabled: true, disabledReason: t('library.selGroupsNeeds', { max: GROUPS_LIMITS.docs }), onSelect: () => {} };
  return { ...base, onSelect: open };
}
