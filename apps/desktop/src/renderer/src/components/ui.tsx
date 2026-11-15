import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface FieldProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  /** Render function receives ids to wire the control to its hint and error. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label + control + hint + inline error, wired with aria attributes. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type FieldExtras = { label: string; hint?: string | undefined; error?: string | undefined };

export function TextField({ label, hint, error, ...input }: FieldExtras & Omit<ComponentPropsWithoutRef<'input'>, 'id'>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => <input {...input} id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
    </Field>
  );
}

export function TextAreaField({ label, hint, error, ...area }: FieldExtras & Omit<ComponentPropsWithoutRef<'textarea'>, 'id'>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => <textarea {...area} id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} />}
    </Field>
  );
}

export function SelectField({ label, hint, error, children, ...select }: FieldExtras & Omit<ComponentPropsWithoutRef<'select'>, 'id'>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => (
        <select {...select} id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function CheckField({ label, hint, ...input }: { label: string; hint?: string } & Omit<ComponentPropsWithoutRef<'input'>, 'id' | 'type'>) {
  const id = useId();
  return (
    <div className="check">
      <input {...input} id={id} type="checkbox" aria-describedby={hint ? `${id}-hint` : undefined} />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function ErrorNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="error-note" role="alert" data-testid={testId}>
      {children}
    </p>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max?: number | undefined; label: string }) {
  const determinate = max !== undefined && max > 0;
  return (
    <div
      className={determinate ? 'progress' : 'progress indeterminate'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      {...(determinate ? { 'aria-valuemax': max, 'aria-valuenow': Math.min(value, max) } : {})}
    >
      <div className="progress-fill" style={determinate ? { width: `${Math.min(100, (value / max) * 100)}%` } : undefined} />
    </div>
  );
}

/** Language selector shared by the wizard and the settings. */
export function LanguageSelect({
  label,
  value,
  onChange,
  testId,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: 'it' | 'en') => void;
  testId?: string;
  hint?: string;
}) {
  const { t } = useTranslation();
  return (
    <SelectField label={label} hint={hint} value={value} onChange={(e) => onChange(e.target.value as 'it' | 'en')} data-testid={testId}>
      <option value="it">{t('languages.it')}</option>
      <option value="en">{t('languages.en')}</option>
    </SelectField>
  );
}
