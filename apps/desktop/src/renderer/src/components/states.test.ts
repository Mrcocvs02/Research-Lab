/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadThemes, parseBlocks, tokenContrast, type Theme } from '../styles/tokensModel';

// Control states of docs/design/ARCHITETTURA-UI.md 5.5.1, checked on the stylesheet of the components: hover and focus never use a
// solid grey fill without a border; disabled is the only state that loses contrast and never shows the focus ring; the ring is 2 px
// --focus at 2 px. jsdom/happy-dom cannot resolve :hover or :focus-visible, so the rules themselves are read and the token pairs measured.
const read = (name: string) => readFileSync(path.join(import.meta.dirname, name), 'utf8');
const rules = [...parseBlocks(read('controls.css')), ...parseBlocks(read('overlays.css'))];
const themes = loadThemes();
const THEMES: [string, Theme][] = [
  ['light', themes.light],
  ['dark', themes.dark],
];

const rulesFor = (selector: RegExp) => rules.filter((r) => r.selector.split(',').some((s) => selector.test(s.trim())));
const decl = (selector: string, prop: string): string | undefined => rules.find((r) => r.selector.split(',').map((s) => s.trim()).includes(selector) && prop in r.decls)?.decls[prop];
const GREY = /var\(--surface-[23]\)/;

describe('every :hover rule is guarded so a disabled control never reacts (5.5.1: no hover on disabled)', () => {
  it('has a :not(:disabled) / :not(.is-disabled) / :not(.is-on) guard', () => {
    const unguarded = rules.flatMap((r) => r.selector.split(',').map((s) => s.trim())).filter((s) => s.includes(':hover') && !/:not\(/.test(s));
    expect(unguarded).toEqual([]);
  });
});

describe('Button: each variant in each state', () => {
  const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;

  it.each(variants)('%s has a hover, an active and a disabled rule, and shares the one focus ring', (v) => {
    expect(rulesFor(new RegExp(`^button\\.rl-btn--${v}:hover:not\\(:disabled\\)$`)).length, `${v} hover`).toBeGreaterThan(0);
    expect(rulesFor(new RegExp(`^button\\.rl-btn--${v}:active:not\\(:disabled\\)$`)).length, `${v} active`).toBeGreaterThan(0);
    expect(rulesFor(new RegExp(`^button\\.rl-btn--${v}:disabled$`)).length, `${v} disabled`).toBeGreaterThan(0);
  });

  it('the focus ring is 2 px --focus at a 2 px offset, for every control', () => {
    for (const sel of ['button.rl-btn:focus-visible', 'button.rl-iconbtn:focus-visible', 'button.rl-seg__opt:focus-visible', 'button.rl-switch:focus-visible', 'button.rl-tab:focus-visible', 'button.rl-chip__main:focus-visible', 'button.rl-toast__action:focus-visible']) {
      expect(decl(sel, 'outline'), sel).toBe('2px solid var(--focus)');
      expect(decl(sel, 'outline-offset'), sel).toBe('2px');
    }
  });

  it('secondary: hover keeps the white fill and darkens the border with a shadow (never a grey fill)', () => {
    const sel = 'button.rl-btn--secondary:hover:not(:disabled)';
    expect(decl(sel, 'background')).toBe('var(--surface)');
    expect(decl(sel, 'border-color')).toBe('var(--text-muted)');
    expect(decl(sel, 'box-shadow')).toBe('var(--e-1)');
  });

  it('primary and danger: hover brightness .92, pressed .85, no border-less grey', () => {
    for (const v of ['primary', 'danger']) {
      expect(decl(`button.rl-btn--${v}:hover:not(:disabled)`, 'filter'), `${v} hover`).toBe('brightness(0.92)');
      expect(decl(`button.rl-btn--${v}:active:not(:disabled)`, 'filter'), `${v} pressed`).toBe('brightness(0.85)');
    }
  });

  it('ghost: hover is surface-2 WITH the text colour kept; pressed is surface-3', () => {
    expect(decl('button.rl-btn--ghost:hover:not(:disabled)', 'background')).toBe('var(--surface-2)');
    expect(decl('button.rl-btn--ghost:hover:not(:disabled)', 'color')).toBe('var(--text)');
    expect(decl('button.rl-btn--ghost:active:not(:disabled)', 'background')).toBe('var(--surface-3)');
  });

  it('a bordered control never turns into a solid grey fill on hover or focus', () => {
    for (const sel of ['button.rl-btn--secondary:hover:not(:disabled)', 'button.rl-btn--primary:hover:not(:disabled)', 'button.rl-btn--danger:hover:not(:disabled)', 'button.rl-iconbtn--secondary:hover:not(:disabled)']) {
      expect(decl(sel, 'background') ?? '', sel).not.toMatch(GREY);
    }
    for (const sel of ['button.rl-btn:focus-visible', 'button.rl-iconbtn:focus-visible']) expect(decl(sel, 'background') ?? '', sel).not.toMatch(GREY);
  });

  it('disabled: no ring (outline none), no shadow, not-allowed cursor, no filter', () => {
    expect(decl('button.rl-btn:disabled', 'outline')).toBe('none');
    expect(decl('button.rl-btn:disabled', 'cursor')).toBe('not-allowed');
    expect(decl('button.rl-btn:disabled', 'box-shadow')).toBe('none');
    expect(decl('button.rl-btn:disabled', 'filter')).toBe('none');
    expect(decl('button.rl-iconbtn:disabled', 'outline')).toBe('none');
  });

  it('disabled primary is surface-3 with muted text (5.5.1) and secondary disabled has the quiet border', () => {
    expect(decl('button.rl-btn--primary:disabled', 'background')).toBe('var(--surface-3)');
    expect(decl('button.rl-btn--primary:disabled', 'color')).toBe('var(--text-muted)');
    expect(decl('button.rl-btn--secondary:disabled', 'border-color')).toBe('var(--border)');
  });

  it('the focus ring is distinguishable from the disabled state: ring only in :focus-visible, never in a :disabled rule', () => {
    const disabledOutlines = rules.filter((r) => r.selector.split(',').some((s) => s.includes(':disabled') && !s.includes(':not(:disabled)')) && 'outline' in r.decls);
    expect(disabledOutlines.every((r) => r.decls['outline'] === 'none')).toBe(true);
    const ringRules = rules.filter((r) => /^2px solid var\(--focus\)$/.test(r.decls['outline'] ?? ''));
    expect(ringRules.length).toBeGreaterThan(5);
    expect(ringRules.every((r) => r.selector.split(',').every((s) => s.includes(':focus-visible')))).toBe(true);
  });
});

describe.each(THEMES)('token pairs behind the states, %s theme', (_n, theme) => {
  const ground = ['bg', 'surface', 'surface-2'];
  it('hover/focus indicators stand out from the ground by 3:1 or more', () => {
    // secondary hover border (--text-muted) and the focus ring (--focus) against every ground a control sits on
    for (const g of ground) {
      expect(tokenContrast(theme, 'text-muted', g), `hover border on ${g}`).toBeGreaterThanOrEqual(3);
      expect(tokenContrast(theme, 'focus', g), `ring on ${g}`).toBeGreaterThanOrEqual(3);
    }
    // the selected chip / pressed icon button / active segment outline (--accent) against the soft accent fill it sits on
    expect(tokenContrast(theme, 'accent', 'accent-soft')).toBeGreaterThanOrEqual(3);
  });

  it('filled variants keep readable text at rest, and the disabled fill is readable (muted on surface-3)', () => {
    expect(tokenContrast(theme, 'on-accent', 'accent')).toBeGreaterThanOrEqual(4.5);
    expect(tokenContrast(theme, 'on-danger', 'danger')).toBeGreaterThanOrEqual(4.5);
    expect(tokenContrast(theme, 'text-muted', 'surface-3')).toBeGreaterThanOrEqual(4.5);
  });

  it('the disabled secondary border is quieter than the resting one (it is the only state that loses contrast)', () => {
    expect(tokenContrast(theme, 'border', 'surface')).toBeLessThan(tokenContrast(theme, 'border-strong', 'surface'));
  });
});

describe('Menu rule in the stylesheet', () => {
  it('a disabled menu item is greyed and not-allowed, and has no hover fill', () => {
    expect(decl('.rl-menu__item.is-disabled', 'cursor')).toBe('not-allowed');
    expect(rules.some((r) => r.selector.includes('.rl-menu__item:hover:not(.is-disabled)'))).toBe(true);
  });
});
