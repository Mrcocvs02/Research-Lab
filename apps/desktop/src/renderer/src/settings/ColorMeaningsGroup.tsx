import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANNOTATION_COLORS } from '@rl/core';
import { useApp } from '../state/app-context';
import { Group, Row, useLibraryPatch } from './rows';
import { useAutoSave } from './useAutoSave';

/**
 * Settings › Library › "Significato dei colori" (feature 36, §17.4.10): what each of the five colours means to the user
 * ("● Giallo — Risultato chiave"). Saved with the library (`annotations.colorMeanings`); the reader shows the names in the
 * tooltips of the colour dots and in the annotation list filter. An empty field means no meaning.
 */
export function ColorMeaningsGroup() {
  const { t } = useTranslation();
  const app = useApp();
  const patch = useLibraryPatch();
  const save = useAutoSave();
  const saved = app.config?.annotations.colorMeanings;
  const [draft, setDraft] = useState<string[]>(saved ?? ['', '', '', '', '']);
  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);
  if (!saved) return null;
  const commit = (next: string[]) => {
    const clean = next.map((v) => v.trim());
    if (clean.every((v, i) => v === saved[i])) return;
    void save.run(() => patch({ annotations: { colorMeanings: clean } }));
  };
  return (
    <Group title={t('settings.colorMeanings.title')} testId="color-meanings" sid="colorMeaningsGroup">
      <Row sid="colorMeanings" label={t('settings.colorMeanings.label')} help={t('settings.colorMeanings.hint')} save={save}>
        <div className="color-meanings">
          {ANNOTATION_COLORS.map((c, i) => (
            <label key={c} className="color-meanings__row">
              <span className="color-meanings__pip" style={{ background: `var(--hl-${c})` }} aria-hidden="true" />
              <span className="color-meanings__name">{t(`reader.colors.${c}`)}</span>
              <input
                value={draft[i] ?? ''}
                maxLength={60}
                placeholder={t('settings.colorMeanings.placeholder')}
                aria-label={t('settings.colorMeanings.field', { color: t(`reader.colors.${c}`) })}
                data-testid={`color-meaning-${c}`}
                onChange={(e) => setDraft(draft.map((v, j) => (j === i ? e.target.value : v)))}
                onBlur={() => commit(draft)}
              />
            </label>
          ))}
        </div>
      </Row>
    </Group>
  );
}
