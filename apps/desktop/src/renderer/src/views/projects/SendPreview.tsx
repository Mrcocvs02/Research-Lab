import { useTranslation } from 'react-i18next';

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
