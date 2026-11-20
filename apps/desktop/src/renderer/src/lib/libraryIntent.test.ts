import { describe, expect, it } from 'vitest';
import { TAG_MANAGER_EVENT, openTagManager, tagPlaceOf, takeLibraryIntent } from './libraryIntent';

describe('direct way into the tag manager', () => {
  it('reads the place of an intent, the Map flag meaning the cleanup', () => {
    expect(tagPlaceOf(null)).toBeNull();
    expect(tagPlaceOf({ tags: ['a'] })).toBeNull();
    expect(tagPlaceOf({ cleanup: true })).toBe('cleanup');
    expect(tagPlaceOf({ manage: 'review' })).toBe('review');
  });
  it('leaves the request, tells a Library already on screen and moves to the Library', () => {
    let heard = 0;
    let moved = 0;
    const on = () => heard++;
    window.addEventListener(TAG_MANAGER_EVENT, on);
    openTagManager(() => moved++, 'cleanup');
    window.removeEventListener(TAG_MANAGER_EVENT, on);
    expect([heard, moved]).toEqual([1, 1]);
    expect(tagPlaceOf(takeLibraryIntent())).toBe('cleanup');
  });
});
