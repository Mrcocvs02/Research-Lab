import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['it', 'en'] as const;
export type UiLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** One chunk per language: only the active dictionary is downloaded and parsed; the other one loads on a language change. */
const DICTIONARIES: Record<UiLanguage, () => Promise<{ default: Record<string, unknown> }>> = {
  it: () => import('./locales/it.json'),
  en: () => import('./locales/en.json'),
};

void i18n
  .use({
    type: 'backend',
    init() {},
    read(language: string, _namespace: string, callback: (error: unknown, data?: Record<string, unknown>) => void) {
      const load = DICTIONARIES[language as UiLanguage];
      if (!load) return callback(new Error('Unsupported language'));
      load().then((m) => callback(null, m.default), callback);
    },
  })
  .use(initReactI18next)
  .init({
    // No `lng` and no fallback: nothing is loaded until the first `changeLanguage` (the stored language, see app-context).
    // The dictionaries have exactly the same keys (tested), so a fallback language would only cost memory.
    fallbackLng: false,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });

export default i18n;
