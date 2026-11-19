import { describe, expect, it } from 'vitest';
import { canBack, canForward, crumbs, currentNav, emptyNav, MAX_NAV, pushNav, stepBack, stepForward, type NavState } from './navStack';

const st = (over: Partial<NavState> = {}): NavState => ({ tab: 'map', family: 'topic', doc: null, center: null, path: null, ...over });

describe('navStack', () => {
  it('starts empty and cannot go anywhere', () => {
    const s = emptyNav();
    expect(currentNav(s)).toBeNull();
    expect(canBack(s)).toBe(false);
    expect(canForward(s)).toBe(false);
    expect(stepBack(s)).toBe(s);
  });

  it('goes back and forward through the states', () => {
    let s = emptyNav();
    for (const d of ['a', 'b', 'c']) s = pushNav(s, st({ doc: d }));
    expect(currentNav(s)?.doc).toBe('c');
    s = stepBack(s);
    expect(currentNav(s)?.doc).toBe('b');
    expect(canForward(s)).toBe(true);
    s = stepForward(s);
    expect(currentNav(s)?.doc).toBe('c');
    expect(stepForward(s)).toBe(s);
  });

  it('drops the states ahead when a new one is recorded after going back', () => {
    let s = emptyNav();
    for (const d of ['a', 'b', 'c']) s = pushNav(s, st({ doc: d }));
    s = pushNav(stepBack(stepBack(s)), st({ doc: 'x' }));
    expect(s.states.map((x) => x.doc)).toEqual(['a', 'x']);
    expect(canForward(s)).toBe(false);
  });

  it('does not record the same state twice in a row', () => {
    const a = pushNav(emptyNav(), st({ doc: 'a', path: ['a', 'b'] }));
    expect(pushNav(a, st({ doc: 'a', path: ['a', 'b'] }))).toBe(a);
    expect(pushNav(a, st({ doc: 'a', path: ['a', 'c'] })).states).toHaveLength(2);
  });

  it('keeps the last 50 states', () => {
    let s = emptyNav();
    for (let i = 0; i < MAX_NAV + 10; i++) s = pushNav(s, st({ doc: `d${i}` }));
    expect(s.states).toHaveLength(MAX_NAV);
    expect(s.states[0]!.doc).toBe('d10');
    expect(currentNav(s)?.doc).toBe(`d${MAX_NAV + 9}`);
    expect(s.at).toBe(MAX_NAV - 1);
  });

  it('lists the centres visited as crumbs, folding a return to an earlier centre', () => {
    let s = emptyNav();
    s = pushNav(s, st({ tab: 'map', doc: 'z' }));
    for (const c of ['a', 'b', 'c']) s = pushNav(s, st({ tab: 'network', center: c }));
    expect(crumbs(s)).toEqual(['a', 'b', 'c']);
    s = pushNav(s, st({ tab: 'network', center: 'a' }));
    expect(crumbs(s)).toEqual(['a']);
    expect(crumbs(stepBack(s))).toEqual(['a', 'b', 'c']);
    expect(crumbs(s, 1)).toEqual(['a']);
  });
});
