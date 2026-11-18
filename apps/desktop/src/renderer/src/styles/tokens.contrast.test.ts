import { describe, expect, it } from 'vitest';
import { contrast, loadThemes, resolve, tokenContrast, type Theme } from './tokensModel';

// WCAG 2.x contrast of the token pairs of docs/design/ARCHITETTURA-UI.md 5.2, in every theme (accent Petrolio and the Indaco alternative).
const themes = loadThemes();
const ALL: [string, Theme][] = [
  ['light', themes.light],
  ['dark', themes.dark],
  ['light + indigo', themes.indigoLight],
  ['dark + indigo', themes.indigoDark],
];

const GROUNDS = ['bg', 'surface', 'surface-2', 'surface-3', 'accent-soft'];
const STATES = ['danger', 'warning', 'success', 'info', 'ai'];

describe.each(ALL)('contrast, %s theme', (_name, theme) => {
  const min = (fg: string, grounds: string[]) => Math.min(...grounds.map((g) => tokenContrast(theme, fg, g)));

  it('text and secondary text are AA (4.5) on every ground they may sit on', () => {
    expect(min('text', GROUNDS)).toBeGreaterThanOrEqual(4.5);
    expect(min('text-muted', GROUNDS)).toBeGreaterThanOrEqual(4.5);
    expect(min('text-subtle', GROUNDS)).toBeGreaterThanOrEqual(4.5);
  });

  it('accent text is AA on the neutral grounds and on the soft accent fill', () => {
    expect(min('accent-text', GROUNDS)).toBeGreaterThanOrEqual(4.5);
  });

  it('state colours are AA on the neutral grounds and on their own soft fill', () => {
    for (const s of STATES) {
      expect(min(s, ['bg', 'surface', 'surface-2']), `${s} on neutrals`).toBeGreaterThanOrEqual(4.5);
      expect(tokenContrast(theme, s, `${s}-soft`), `${s} on ${s}-soft`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text on filled controls is AA: on-accent on accent, on-danger on danger', () => {
    expect(tokenContrast(theme, 'on-accent', 'accent')).toBeGreaterThanOrEqual(4.5);
    expect(tokenContrast(theme, 'on-danger', 'danger')).toBeGreaterThanOrEqual(4.5);
  });

  it('non-text indicators reach 3:1 (WCAG 1.4.11): accent, focus ring, field and chip borders, hover border', () => {
    expect(min('accent', ['bg', 'surface']), 'accent').toBeGreaterThanOrEqual(3);
    expect(min('focus', ['bg', 'surface', 'surface-2', 'surface-3', 'accent-soft']), 'focus ring').toBeGreaterThanOrEqual(3);
    expect(min('border-strong', ['bg', 'surface', 'surface-2']), 'border-strong').toBeGreaterThanOrEqual(3);
    // 5.5.1: the secondary button and the chip show hover with a darker border: it must stand out from the ground by 3:1 too.
    expect(min('text-muted', ['bg', 'surface', 'surface-2']), 'hover border').toBeGreaterThanOrEqual(3);
  });

  it('file-type badges are AA on their own background', () => {
    for (const t of ['pdf', 'md', 'office']) expect(tokenContrast(theme, `type-${t}`, `type-${t}-bg`), t).toBeGreaterThanOrEqual(4.5);
  });

  it('library tints are visible (3:1) on the sidebar and surface grounds', () => {
    for (let i = 1; i <= 8; i++) expect(min(`lib-${i}`, ['bg', 'surface', 'surface-2']), `lib-${i}`).toBeGreaterThanOrEqual(3);
  });

  it('a disabled control stays distinguishable from a focused one: the primary disabled fill differs from the ground by its own tone', () => {
    // 5.5.1: disabled primary is surface-3 with muted text (AA); the ring exists only in the focus state (checked in components/states.test.ts).
    expect(tokenContrast(theme, 'text-muted', 'surface-3')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contrast, annotation colours (5.2.3)', () => {
  it('black text on every highlight fill is AA (the PDF page is white in both themes)', () => {
    for (const c of ['yellow', 'green', 'blue', 'pink', 'orange']) expect(contrast('#000000', resolve(themes.light, `hl-${c}`)), c).toBeGreaterThanOrEqual(7);
  });

  it('underline strokes reach 3:1 on the white page', () => {
    for (const c of ['yellow', 'green', 'blue', 'pink', 'orange']) expect(contrast(resolve(themes.light, `ul-${c}`), resolve(themes.light, 'page-bg')), c).toBeGreaterThanOrEqual(3);
  });
});

describe('theme blocks', () => {
  it('the prefers-color-scheme block equals the explicit dark block (same overrides, so the system and the user choice agree)', () => {
    const over = (t: Theme, base: Theme) => Object.fromEntries(Object.entries(t).filter(([k, v]) => base[k] !== v));
    expect(themes.darkMedia).toEqual(over(themes.dark, themes.light));
    expect(themes.indigoDarkMedia).toEqual(over(themes.indigoDark, themes.dark));
  });

  it('dark overrides every colour token of light that differs between themes (no light value leaks into dark)', () => {
    const colour = (k: string) => /^--(bg|surface|border|text|accent|on-|focus|danger|warning|success|info|ai|scrim|type-|lib-|cat-)/.test(k);
    for (const k of Object.keys(themes.light).filter(colour)) {
      if (themes.light[k]!.startsWith('var(')) continue;
      expect(themes.dark[k], k).toBeDefined();
    }
    for (const k of ['--bg', '--surface', '--text', '--accent', '--danger', '--ai']) expect(themes.dark[k], k).not.toBe(themes.light[k]);
  });

  it('documents the Petrolio accent of 5.2.1 (provisional D-378)', () => {
    expect(resolve(themes.light, 'accent')).toBe('#0f6e78');
    expect(resolve(themes.dark, 'accent')).toBe('#5cc6cf');
  });
});
