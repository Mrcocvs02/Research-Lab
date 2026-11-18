import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['it', 'en'] as const;
export type UiLanguage = (typeof SUPPORTED_LANGUAGES)[number];

type Dictionary = Record<string, unknown>;

/**
 * The strings of a language come in pieces: a core (`locales/<lng>.json`, what the first screen and the shared components
 * use) and parts (`locales/parts/<lng>/<part>.json`) that load together with the lazy view that needs them (`lazyView`).
 * Keys never change: a part only holds a share of the same dictionary. A part used by several views loads once.
 */
export type StringPart =
  | 'activity'
  | 'addToProject'
  | 'advSearch'
  | 'aiSettings'
  | 'backup'
  | 'chat'
  | 'chat-preview'
  | 'citations'
  | 'discover'
  | 'doc'
  | 'doc-projects-reader'
  | 'doc-reader'
  | 'doc-review'
  | 'guide'
  | 'history'
  | 'inbox'
  | 'export'
  | 'jobs'
  | 'library'
  | 'mcp'
  | 'network'
  | 'palette'
  | 'projects'
  | 'reader'
  | 'review'
  | 'settings'
  | 'settings-wizard'
  | 'shortcuts'
  | 'taxonomy'
  | 'wizard';

const CORE: Record<UiLanguage, () => Promise<{ default: Dictionary }>> = {
  it: () => import('./locales/it.json'),
  en: () => import('./locales/en.json'),
};
const PARTS = import.meta.glob<{ default: Dictionary }>('./locales/parts/*/*.json');
const partLoader = (lng: string, part: string) => PARTS[`./locales/parts/${lng}/${part}.json`];

/** Parts asked for so far: every language that is loaded afterwards gets them with its core. */
const wanted = new Set<string>();
/** `lng/part` already in the i18next store. */
const installed = new Set<string>();

async function readPart(lng: string, part: string): Promise<Dictionary> {
  const load = partLoader(lng, part);
  if (!load) throw new Error(`Unknown strings part ${part}`);
  return (await load()).default;
}

/** Adds the wanted parts missing for `lng`; returns how many were added. */
async function installParts(lng: string): Promise<number> {
  const missing = [...wanted].filter((p) => !installed.has(`${lng}/${p}`));
  if (missing.length === 0) return 0;
  const data = await Promise.all(missing.map((p) => readPart(lng, p)));
  missing.forEach((p, i) => {
    installed.add(`${lng}/${p}`);
    i18n.addResourceBundle(lng, 'translation', data[i]!, true, true);
  });
  return missing.length;
}

/** Loads the strings parts a lazy view needs (together with its code, see `lazyView`) for the current language. */
export async function loadStrings(parts: readonly StringPart[]): Promise<void> {
  for (const p of parts) if (!partLoader('en', p)) throw new Error(`Unknown strings part ${p}`);
  for (const p of parts) wanted.add(p);
  // The language can change while a part loads: repeat until the current one has everything asked for.
  for (let lng = i18n.language; lng; lng = i18n.language) {
    await installParts(lng);
    if (i18n.language === lng) return;
  }
}

/**
 * Switches the UI language: its core and every part already loaded are in place before the UI re-renders
 * (a part loaded while another language was active is added here).
 */
export async function setLanguage(language: UiLanguage): Promise<void> {
  await i18n.loadLanguages(language);
  await installParts(language);
  await i18n.changeLanguage(language);
  // A part asked for during the switch: add it and render again.
  if ((await installParts(language)) > 0) await i18n.changeLanguage(language);
}

// Unit tests render views directly (not through their lazy loaders): they get every part.
if (import.meta.env.MODE === 'test') for (const k of Object.keys(PARTS)) wanted.add(k.split('/').pop()!.replace(/\.json$/, ''));

void i18n
  .use({
    type: 'backend',
    init() {},
    read(language: string, _namespace: string, callback: (error: unknown, data?: Dictionary) => void) {
      const load = CORE[language as UiLanguage];
      if (!load) return callback(new Error('Unsupported language'));
      // The core and every part wanted so far form the language; i18next stores the merged result.
      const merged = async () => {
        const core = structuredClone((await load()).default);
        const names = [...wanted];
        const data = await Promise.all(names.map((p) => readPart(language, p)));
        names.forEach((p) => installed.add(`${language}/${p}`));
        const mergeInto = (to: Dictionary, from: Dictionary) => {
          for (const [k, v] of Object.entries(from)) {
            if (v && typeof v === 'object') mergeInto((to[k] ??= {}) as Dictionary, v as Dictionary);
            else to[k] = v;
          }
        };
        for (const d of data) mergeInto(core, d);
        return core;
      };
      merged().then((d) => callback(null, d), callback);
    },
  })
  .use(initReactI18next)
  .init({
    // No `lng` and no fallback: nothing is loaded until the first language change (the stored language, see app-context).
    // The dictionaries have exactly the same keys (tested), so a fallback language would only cost memory.
    fallbackLng: false,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });

export default i18n;
