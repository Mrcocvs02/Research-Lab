import { describe, expect, it } from 'vitest';
import i18n, { loadStrings, setLanguage, type StringPart } from './index';
import { flatten, partOf, type Tree } from './testing';

const at = (tree: Tree, key: string) => key.split('.').reduce<string | Tree | undefined>((o, k) => (typeof o === 'object' ? o[k] : undefined), tree);
// A key whose text differs between the languages.
const wizardKey = flatten(partOf('en', 'wizard')).find((k) => at(partOf('en', 'wizard'), k) !== at(partOf('it', 'wizard'), k))!;

describe('loading strings by part', () => {
  it('serves a part in both languages, and again when switching back', async () => {
    await setLanguage('en');
    await loadStrings(['wizard']);
    expect(i18n.t(wizardKey)).toBe(at(partOf('en', 'wizard'), wizardKey));
    await setLanguage('it');
    expect(i18n.language).toBe('it');
    expect(i18n.t(wizardKey)).toBe(at(partOf('it', 'wizard'), wizardKey));
    expect(i18n.t(wizardKey)).not.toBe(at(partOf('en', 'wizard'), wizardKey));
    await setLanguage('en');
    expect(i18n.t(wizardKey)).toBe(at(partOf('en', 'wizard'), wizardKey));
  });

  it('loads a part used by several views once and refuses an unknown one', async () => {
    await setLanguage('en');
    await Promise.all([loadStrings(['doc']), loadStrings(['doc', 'history'])]);
    await expect(loadStrings(['nope' as StringPart])).rejects.toThrow('Unknown strings part');
  });
});
