import { describe, expect, it } from 'vitest';
import { jobGroup, publishActivity, scanGroup, summarize } from './activityModel';
import { crumbsOf } from './Topbar';

const job = (state: string, done = 0, failed = 0) => ({ state, done, failed });

describe('activity model', () => {
  it('groups jobs: live, failed or partial need a look, the rest is a result', () => {
    expect(jobGroup(job('running'))).toBe('running');
    expect(jobGroup(job('failed'))).toBe('attention');
    expect(jobGroup(job('done', 5, 1))).toBe('attention');
    expect(jobGroup(job('done', 5))).toBe('recent');
    expect(jobGroup(job('cancelled'))).toBe('recent');
    expect(scanGroup({ state: 'idle' })).toBeNull();
  });
  it('summarises what the chip shows', () => {
    const s = summarize({ scan: { state: 'running', processed: 1, total: 4 }, job: job('failed'), citation: null, generic: [{ id: 'x', group: 'running', text: 'Backup' }] });
    expect(s).toEqual({ running: 2, attention: 1, progress: 0.25, main: 'scan' });
    publishActivity('t', []);
  });
  it('builds the crumbs', () => {
    const label = (k: string) => k;
    expect(crumbsOf({ view: 'library' }, null, label)).toEqual([{ label: 'sections.library' }]);
    expect(crumbsOf({ view: 'reader', docId: 'd' }, 'Title', label).map((c) => c.label)).toEqual(['sections.library', 'Title']);
    expect(crumbsOf({ view: 'review', tab: 'proposals' }, null, label).map((c) => c.label)).toEqual(['sections.review', 'shell.crumbProposals']);
  });
});
