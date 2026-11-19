import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../state/app-context';

/** The model of a send: the configured ones, the default first chosen; `value` is null while the user has not picked one. */
export function ModelPick({ value, onChange, preferHaiku }: { value: string | null; onChange(model: string): void; preferHaiku?: boolean }) {
  const { t } = useTranslation();
  const { config } = useApp();
  const id = useId();
  const models = config?.ai.models ?? [];
  const fallback = (preferHaiku ? models.find((m) => /haiku/i.test(m.id))?.id : undefined) ?? config?.ai.defaultModel ?? models[0]?.id ?? '';
  if (models.length < 2) return null;
  return (
    <div className="field">
      <label htmlFor={id}>{t('schema.model')}</label>
      <select id={id} value={value ?? fallback} onChange={(e) => onChange(e.target.value)} data-testid="send-model">
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label || m.id}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The exact text that would leave the machine, in a box nobody edits, with what it costs (D-423, D-416). */
export function SendPreview({ text, what, facts, blocked, testId }: { text: string; what: string; facts: string; blocked: string | null; testId: string }) {
  const { t } = useTranslation();
  return (
    <div className="schema-send" data-testid={testId}>
      <p>{what}</p>
      <pre className="schema-send__text" tabIndex={0} aria-label={t('schema.exactText')} data-testid={`${testId}-text`}>
        {text}
      </pre>
      <p className="hint" data-testid={`${testId}-facts`}>
        {facts}
      </p>
      {blocked && <p className="callout">{blocked}</p>}
    </div>
  );
}
