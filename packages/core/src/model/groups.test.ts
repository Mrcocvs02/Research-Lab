import { describe, expect, it } from 'vitest';
import { dedupeGroups, groupTagId, groupTagLabel, isGroupTag, visibleGroupTags } from './groups.js';

describe('research-group tags (D-488)', () => {
  it('builds the id from the name and reads the label back', () => {
    expect(groupTagId('  Lab   One ')).toBe('grp:Lab One');
    expect(isGroupTag('grp:Lab One')).toBe(true);
    expect(isGroupTag('topic')).toBe(false);
    expect(groupTagLabel('grp:Lab One')).toBe('Lab One');
    expect(groupTagLabel('topic')).toBe('topic');
  });
  it('drops repeats (case and spacing) and empty names, keeping the first spelling', () => {
    expect(dedupeGroups(['Lab One', 'lab  one', '', '  ', 'Lab Two'])).toEqual(['Lab One', 'Lab Two']);
    expect(dedupeGroups(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });
  it('hides the groups the user hid, and tolerates records without the fields', () => {
    expect(visibleGroupTags({ groups: ['Lab One', 'Lab Two'], groupsHidden: ['lab one'] })).toEqual(['grp:Lab Two']);
    expect(visibleGroupTags({})).toEqual([]);
  });
});
