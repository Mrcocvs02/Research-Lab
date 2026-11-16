import { describe, expect, it } from 'vitest';
import { PROJECT_LIMITS, SEARCH_LIMITS } from '../limits.js';
import { channels } from './channels/index.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => i.toString(16).padStart(16, '0'));
const accepts = (channel: keyof typeof channels, payload: unknown) => channels[channel].request.safeParse(payload).success;

describe('bulk limits agree with what a selection can hold', () => {
  it('Ctrl+A (documents:ids) and a tag change share one ceiling', () => {
    expect(SEARCH_LIMITS.idsMax).toBe(50_000);
    expect(accepts('documents:tag', { docIds: ids(SEARCH_LIMITS.idsMax), add: ['a'] })).toBe(true);
    expect(accepts('documents:tag', { docIds: ids(SEARCH_LIMITS.idsMax + 1), add: ['a'] })).toBe(false);
    expect(accepts('documents:tag', { docIds: [], add: ['a'] })).toBe(false);
  });

  it('project channels take as many documents as a project can hold', () => {
    const n = PROJECT_LIMITS.members;
    expect(accepts('projects:addMembers', { projectId: 'p', docIds: ids(n) })).toBe(true);
    expect(accepts('projects:addMembers', { projectId: 'p', docIds: ids(n + 1) })).toBe(false);
    expect(accepts('projects:removeMembers', { projectId: 'p', docIds: ids(n) })).toBe(true);
    expect(accepts('projects:create', { name: 'x', docIds: ids(n) })).toBe(true);
    expect(accepts('projects:create', { name: 'x', docIds: ids(n + 1) })).toBe(false);
  });
});
