import { describe, expect, it } from 'vitest';
import { byline, centralPapers, cutTitle, placeTopicLabels, planPaperLabels, TOPIC_LABEL_H, type Box } from './labelsLod';

const apart = (a: Box, b: Box): boolean => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

describe('labels of the papers', () => {
  it('places no two boxes over each other, nor over the names of the blocks', () => {
    const fixed: Box[] = [{ x: 10, y: 10, w: 100, h: 18 }];
    const cands = Array.from({ length: 60 }, (_, id) => ({ id, x: (id % 10) * 40, y: Math.floor(id / 10) * 20, w: 90, h: 30, rank: id % 7 }));
    const placed = planPaperLabels(cands, fixed, 600, 300);
    const boxes = [...fixed, ...placed.map((i) => cands[i]!)];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(apart(boxes[i]!, boxes[j]!)).toBe(true);
    expect(placed.length).toBeGreaterThan(5);
  });

  it('places the forced ones first and drops what is out of the view', () => {
    const cands = [
      { id: 0, x: 0, y: 0, w: 80, h: 30, rank: 9 },
      { id: 1, x: 10, y: 5, w: 80, h: 30, rank: 0, forced: true },
      { id: 2, x: 900, y: 0, w: 80, h: 30, rank: 9 },
    ];
    expect(planPaperLabels(cands, [], 500, 300)).toEqual([1]);
  });

  it('cuts a title at a word with an ellipsis, and writes "Surname year"', () => {
    expect(cutTitle('Attention is all you need for everything', 20)).toBe('Attention is all…');
    expect(cutTitle('Short', 20)).toBe('Short');
    expect(cutTitle('Supercalifragilisticexpialidocious', 12)).toBe('Supercalifr…');
    expect(byline(['Vaswani, Ashish', 'Shazeer, Noam'], 2017)).toBe('Vaswani 2017');
    expect(byline(['Ada Lovelace'], null)).toBe('Lovelace');
    expect(byline([], 1999)).toBe('1999');
  });

  it('picks the top tenth by degree and at least one paper per block', () => {
    const degree = [5, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const block = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const c = centralPapers(degree, block);
    expect(c.has(0)).toBe(true);
    expect([...c].some((i) => block[i] === 1)).toBe(true);
    expect(c.size).toBeLessThanOrEqual(4);
  });
});

describe('names of the topics in the free layout (W19)', () => {
  it('a name never lands on a title already drawn', () => {
    const item = { id: 1, box: { x0: 200, y0: 200, x1: 300, y1: 260 }, w: 90, size: 5 };
    const free = placeTopicLabels([item], 600, 400);
    expect(free.get(1)).toEqual({ x: 250, y: 200 - TOPIC_LABEL_H / 2 - 4 }); // above the core
    const title: Box = { x: 190, y: 170, w: 120, h: 30 };
    const moved = placeTopicLabels([item], 600, 400, [title]);
    const at = moved.get(1)!;
    expect(at).not.toEqual(free.get(1));
    expect(apart(title, { x: at.x - 45, y: at.y - TOPIC_LABEL_H / 2, w: 90, h: TOPIC_LABEL_H })).toBe(true);
  });
});
