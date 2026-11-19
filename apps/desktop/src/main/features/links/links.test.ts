import { describe, expect, it } from 'vitest';
import { linkTargets } from './index.js';

describe('links between notes', () => {
  it('finds the documents a note links to by identifier, once each, whatever the saved title', () => {
    const body = 'See [[Old title|lab://doc/0123456789abcdef]] and [[Other|lab://doc/fedcba9876543210?page=3]], again [[Renamed|lab://doc/0123456789abcdef]].';
    expect(linkTargets(body)).toEqual(['0123456789abcdef', 'fedcba9876543210']);
  });

  it('ignores projects, malformed identifiers and plain text', () => {
    expect(linkTargets('[[P|lab://project/abc]] [[x|lab://doc/XYZ]] [[no target]] [a](lab://doc/0123456789abcdef)')).toEqual([]);
  });
});
