import type { TFunction } from 'i18next';
import type { MenuItem } from '../../../../components/Menu';

/** "Trova collegamenti…" of the selection bar's menu (§18.2, D-480): opens the link finder; no Claude. */
export function linksItem(t: TFunction, open: () => void): MenuItem {
  return { id: 'links', testId: 'selection-links', label: t('library.selLinks'), onSelect: open };
}
