import type { TFunction } from 'i18next';
import type { MenuItem } from '../../../../components/Menu';
import { setTimelineIntent } from '../../../../lib/timelineIntent';

/** "Linea del tempo" of the selection bar's menu: opens the Map with only the selection laid out by year (D-426). */
export function timelineItem(t: TFunction, ids: readonly string[], go: () => void): MenuItem {
  return {
    id: 'timeline',
    testId: 'selection-timeline',
    label: t('library.selTimeline'),
    onSelect: () => {
      setTimelineIntent([...ids]);
      go();
    },
  };
}
