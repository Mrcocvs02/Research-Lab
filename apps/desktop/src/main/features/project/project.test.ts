import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { citeSchema, citeSystem, CITE_VERSION, citePrompt, linkMarkers, reportPrompt, reportSchema, reportSystem, REPORT_VERSION } from './prompt.js';
import { listClaims, listReports, parseClaim, parseOutline, readConsent, readOutline, serializeClaim, serializeOutline, writeClaim, writeConsent, writeOutline, writeReport } from './store.js';

const D1 = '0123456789abcdef';
const D2 = 'fedcba9876543210';

describe('outline.md', () => {
  const outline = { idea: 'Does X work?\n## not a heading', questions: [{ id: 'q1', text: 'Is X accurate with few data?', sources: [D1, D2] }, { id: 'q2', text: 'Why?', sources: [] }], hypotheses: ['H1: error grows below 100 samples'], plan: 'Read, then test.' };

  it('round-trips, keeping the ids of the questions, their sources and a line that looks like a heading', () => {
    expect(parseOutline(serializeOutline(outline))).toEqual(outline);
  });

  it('has no outline in a file without sections', () => {
    expect(parseOutline('just text')).toBeNull();
  });
});

describe('claims', () => {
  const claim = { id: 'c1', questionId: 'q1', text: 'Under 100 samples the error grows', evidence: [{ docId: D1, page: 7, annId: 'a1', stance: 'supports' as const, excerpt: 'error grows' }, { docId: D2, page: 9, stance: 'contradicts' as const, excerpt: '' }] };

  it('round-trips with links by identifier and page', () => {
    const md = serializeClaim(claim);
    expect(md).toContain(`lab://doc/${D1}?page=7&ann=a1`);
    expect(parseClaim(md)).toEqual(claim);
  });

  it('keeps a claim without a question or without evidence', () => {
    expect(parseClaim(serializeClaim({ id: 'c2', questionId: null, text: 'T', evidence: [] }))).toEqual({ id: 'c2', questionId: null, text: 'T', evidence: [] });
  });
});

describe('files of a project', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('writes outline, claims, reports and the consent under projects/<id>/', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'rl-x7-'));
    expect(await readOutline(dir, 'p1')).toBeNull();
    await writeOutline(dir, 'p1', { idea: 'I', questions: [], hypotheses: [], plan: '' });
    expect((await readOutline(dir, 'p1'))?.idea).toBe('I');
    await writeClaim(dir, 'p1', { id: 'c1', questionId: null, text: 'T', evidence: [] });
    expect(await listClaims(dir, 'p1')).toHaveLength(1);
    await writeReport(dir, 'p1', '2026-11-19', '# Title\nbody');
    expect(await listReports(dir, 'p1')).toEqual([{ date: '2026-11-19', title: 'Title' }]);
    expect(await readFile(path.join(dir, 'projects', 'p1', 'reports', '2026-11-19.md'), 'utf8')).toContain('body');
    expect(await readConsent(dir, 'p1')).toBeNull();
    expect(await writeConsent(dir, 'p1', true)).not.toBeNull();
    expect(await readConsent(dir, 'p1')).not.toBeNull();
    await writeConsent(dir, 'p1', false);
    expect(await readConsent(dir, 'p1')).toBeNull();
  });

  it('refuses an id that is not a safe name', async () => {
    await expect(readOutline('x', '../evil')).rejects.toThrow();
  });
});

describe('prompts', () => {
  it('are versioned, structured and mark the user text as data', () => {
    expect(reportSystem('it', 'advisor')).toContain(REPORT_VERSION);
    expect(citeSystem('en')).toContain(CITE_VERSION);
    expect(reportSystem('it', 'group')).toContain('Italian');
    expect(reportPrompt('x <<<DATA y')).not.toContain('<<<DATA y');
    expect(citePrompt('par', [{ id: 'C1', meta: 'title: T', snippet: 's' }])).toContain('<<<DATA candidate C1');
    expect(reportSchema.safeParse({ markdown: 'a' }).success).toBe(true);
    expect(citeSchema.safeParse({ ranking: [{ id: 'C1', reason: 'r' }] }).success).toBe(true);
  });

  it('turns the markers of the report into links by identifier and drops the unknown ones', () => {
    const refs = new Map([['R1', { docId: D1, title: 'A [paper]' }]]);
    expect(linkMarkers('It holds [R1]. Also [R9].', refs)).toBe(`It holds [A paper](lab://doc/${D1}). Also.`);
  });
});
