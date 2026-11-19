import { describe, expect, it } from 'vitest';
import type { Claim, Outline } from '@rl/core';
import { citeSnippet, claimsByQuestion, claimState, draftToOutline, noteParagraphs, outlineToDraft, visibleClaims } from './schemaModel';

const D = '0123456789abcdef';
const ev = (stance: 'supports' | 'contradicts') => ({ docId: D, page: 1, stance, excerpt: '' });
const claim = (id: string, questionId: string | null, evidence: Claim['evidence']): Claim => ({ id, questionId, text: id, evidence });
const outline: Outline = { idea: 'i', questions: [{ id: 'q1', text: 'A?', sources: [D] }, { id: 'q2', text: 'B?', sources: [] }], hypotheses: [], plan: '' };

describe('claims and the filter "Solo prove"', () => {
  it('tells no evidence, evidence on one side and a dispute', () => {
    expect(claimState(claim('a', null, []))).toBe('none');
    expect(claimState(claim('a', null, [ev('supports')]))).toBe('ok');
    expect(claimState(claim('a', null, [ev('supports'), ev('contradicts')]))).toBe('disputed');
  });

  it('keeps only the claims with evidence when the filter is on, and drops questions left empty', () => {
    const claims = [claim('a', 'q1', [ev('supports')]), claim('b', 'q2', [])];
    expect(visibleClaims(claims, true).map((c) => c.id)).toEqual(['a']);
    expect(claimsByQuestion(outline, visibleClaims(claims, true), true).map((g) => g.id)).toEqual(['q1']);
    expect(claimsByQuestion(outline, claims, false).map((g) => g.id)).toEqual(['q1', 'q2']);
  });

  it('puts the claims of an unknown question in a last group', () => {
    const g = claimsByQuestion(outline, [claim('a', 'gone', [])], false);
    expect(g.at(-1)).toMatchObject({ id: null, index: null });
  });
});

describe('the outline from its boxes', () => {
  it('keeps the id of a question that is kept or only reworded, and gives new ones to new lines', () => {
    const next = draftToOutline({ ...outlineToDraft(outline), questions: 'A?\nB reworded?\nNew?' }, outline);
    expect(next.questions.map((q) => q.id).slice(0, 2)).toEqual(['q1', 'q2']);
    expect(next.questions[0]!.sources).toEqual([D]);
    expect(next.questions[2]!.id).not.toMatch(/^q[12]$/);
  });

  it('ignores empty lines', () => {
    expect(draftToOutline({ idea: ' x ', questions: '\n\n', hypotheses: 'h\n\n', plan: '' }, null)).toEqual({ idea: 'x', questions: [], hypotheses: ['h'], plan: '' });
  });
});

describe('paragraphs for citation suggestions', () => {
  const notes = '# Title\n\nThis paragraph explains the method in some detail, with enough words.\n\nAnother one already cites a source \\cite{key} in its text, long enough.\n\n```\ncode block that is not text at all, long enough to count\n```\n\n| a | b |';
  it('lists the text paragraphs only, flags the cited ones, skips headings, code and tables', () => {
    const p = noteParagraphs(notes);
    expect(p.map((x) => x.cited)).toEqual([false, true]);
  });

  it('makes the key to copy', () => {
    expect(citeSnippet('k1', 'latex')).toBe('\\cite{k1}');
    expect(citeSnippet('k1', 'pandoc')).toBe('[@k1]');
  });
});
