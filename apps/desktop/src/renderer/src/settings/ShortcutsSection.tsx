import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SHORTCUT_COMMANDS, SHORTCUT_IDS, effectiveShortcuts, findShortcutConflicts, type ShortcutId, type ShortcutOverride } from '@rl/core';
import { ErrorNote } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { FIXED_ACCELERATORS, eventAccelerator } from '../lib/keymap';
import { RlError } from '../lib/rl-error';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import './shortcuts.css';

const SCOPES = ['global', 'reader'] as const;

/** Overrides to save: only the commands whose accelerator differs from the default (an empty list = all defaults). */
export function overridesOf(effective: Record<ShortcutId, string | null>): ShortcutOverride[] {
  return SHORTCUT_IDS.filter((id) => effective[id] !== SHORTCUT_COMMANDS[id].default).map((id) => ({ id, accelerator: effective[id] }));
}

/**
 * The keyboard shortcuts editor (D-257): the commands by scope, each with its accelerator. "Change" records the next key
 * press (Esc cancels), "Turn off" disables the command, "Default" restores one, "Reset all" restores every default.
 * Two commands on the same key in the same place (or against a global one) are shown, and saving is refused until the
 * conflict is solved. Fixed keys (Esc, Enter, arrows, Ctrl+A/C/V/X) cannot be assigned.
 */
export function ShortcutsSection() {
  const { t } = useTranslation();
  const app = useApp();
  const headId = useId();
  const saved = app.settings?.shortcuts;
  const [draft, setDraft] = useState<Record<ShortcutId, string | null>>(() => effectiveShortcuts(saved ?? []));
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [problem, setProblem] = useState<{ id: ShortcutId; text: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [justSaved, setJustSaved] = useState(false);
  const recorder = useRef<HTMLButtonElement | null>(null);

  // The saved list reaches the draft again after a save or a restore of the settings.
  useEffect(() => setDraft(effectiveShortcuts(saved ?? [])), [saved]);
  useEffect(() => {
    if (recording) recorder.current?.focus();
  }, [recording]);

  const conflicts = useMemo(() => findShortcutConflicts(draft), [draft]);
  const conflicting = useMemo(() => new Set(conflicts.flat()), [conflicts]);
  const savedEffective = useMemo(() => effectiveShortcuts(saved ?? []), [saved]);
  const dirty = SHORTCUT_IDS.some((id) => draft[id] !== savedEffective[id]);
  const isDefault = SHORTCUT_IDS.every((id) => draft[id] === SHORTCUT_COMMANDS[id].default);

  const set = (id: ShortcutId, accelerator: string | null) => {
    setDraft((d) => ({ ...d, [id]: accelerator }));
    setJustSaved(false);
    setProblem(null);
  };

  const onRecordKey = (id: ShortcutId, e: ReactKeyboardEvent) => {
    // The key press belongs to the recorder: no command of the window may answer it.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return setRecording(null);
    const accel = eventAccelerator(e.nativeEvent);
    if (accel === null) {
      // A lone modifier is just the start of a combination; a key without Ctrl or Alt is refused with the reason.
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) setProblem({ id, text: t('shortcuts.needsModifier') });
      return;
    }
    if (FIXED_ACCELERATORS.includes(accel)) return setProblem({ id, text: t('shortcuts.fixedKey', { key: accel }) });
    set(id, accel);
    setRecording(null);
  };

  const save = async () => {
    setError(null);
    try {
      await rl.invoke('settings:set', { shortcuts: overridesOf(draft) });
      await app.refresh();
      setJustSaved(true);
    } catch (e) {
      setError(e);
    }
  };

  const label = (id: ShortcutId) => t(`shortcuts.commands.${id}`);
  // The main process refuses a conflict too (a race with another window, D-301): name the commands it found.
  const saveErrorText = (e: unknown): string => {
    const err = RlError.from(e);
    if (err.code === 'INVALID_REQUEST' && err.details?.reason === 'shortcut-conflict') {
      const ids = new Set<string>();
      const raw = err.details.conflicts;
      for (const c of Array.isArray(raw) ? raw : []) for (const id of Array.isArray(c) ? c : c && typeof c === 'object' ? Object.values(c) : [c]) if (typeof id === 'string' && (SHORTCUT_IDS as readonly string[]).includes(id)) ids.add(id);
      return t('shortcuts.conflictRefused', { commands: [...ids].map((id) => label(id as ShortcutId)).join(', ') || '-' });
    }
    return errorMessage(e, t);
  };
  const conflictText = (a: ShortcutId, b: ShortcutId) => t('shortcuts.conflict', { a: label(a), b: label(b), key: draft[a] ?? '' });

  return (
    <section className="card" aria-labelledby={headId} data-testid="shortcuts-section">
      <h2 id={headId}>{t('shortcuts.title')}</h2>
      <p className="hint">{t('shortcuts.intro')}</p>
      {SCOPES.map((scope) => (
        <div className="group" key={scope}>
          <h3>{t(`shortcuts.scope.${scope}`)}</h3>
          <p className="hint">{t(`shortcuts.scopeHint.${scope}`)}</p>
          <table className="shortcut-table" data-testid={`shortcuts-${scope}`}>
            <caption className="sr-only">{t(`shortcuts.scope.${scope}`)}</caption>
            <thead>
              <tr>
                <th scope="col">{t('shortcuts.command')}</th>
                <th scope="col">{t('shortcuts.key')}</th>
                <th scope="col">
                  <span className="sr-only">{t('shortcuts.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUT_IDS.filter((id) => SHORTCUT_COMMANDS[id].scope === scope).map((id) => {
                const accel = draft[id];
                const bad = conflicting.has(id);
                const isRecording = recording === id;
                return (
                  <tr key={id} data-testid="shortcut-row" data-command={id} data-conflict={bad || undefined} data-changed={accel !== SHORTCUT_COMMANDS[id].default || undefined}>
                    <th scope="row">{label(id)}</th>
                    <td>
                      {isRecording ? (
                        <button
                          type="button"
                          ref={recorder}
                          className="shortcut-recorder"
                          onKeyDown={(e) => onRecordKey(id, e)}
                          onBlur={() => setRecording((cur) => (cur === id ? null : cur))}
                          data-testid="shortcut-recorder"
                          aria-label={t('shortcuts.recordingLabel', { command: label(id) })}
                        >
                          {t('shortcuts.recording')}
                        </button>
                      ) : accel ? (
                        <kbd className="kbd" data-testid="shortcut-key">
                          {accel}
                        </kbd>
                      ) : (
                        <span className="hint" data-testid="shortcut-key">
                          {t('shortcuts.off')}
                        </span>
                      )}
                      {bad && !isRecording && (
                        <span className="field-error" role="alert">
                          {t('shortcuts.conflictShort')}
                        </span>
                      )}
                      {problem?.id === id && (
                        <span className="field-error" role="alert" data-testid="shortcut-problem">
                          {problem.text}
                        </span>
                      )}
                    </td>
                    <td className="row-actions">
                      <button type="button" onClick={() => (setProblem(null), setRecording(id))} aria-label={t('shortcuts.changeFor', { command: label(id) })} data-testid="shortcut-change">
                        {t('shortcuts.change')}
                      </button>
                      <button type="button" onClick={() => set(id, null)} disabled={accel === null} aria-label={t('shortcuts.offFor', { command: label(id) })} data-testid="shortcut-off">
                        {t('shortcuts.turnOff')}
                      </button>
                      <button type="button" onClick={() => set(id, SHORTCUT_COMMANDS[id].default)} disabled={accel === SHORTCUT_COMMANDS[id].default} aria-label={t('shortcuts.defaultFor', { command: label(id), key: SHORTCUT_COMMANDS[id].default })} data-testid="shortcut-default">
                        {t('shortcuts.default')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <p className="hint">{t('shortcuts.fixed')}</p>
      {conflicts.length > 0 && (
        <div className="callout warn" role="alert" data-testid="shortcuts-conflicts">
          <p>{t('shortcuts.conflictsTitle')}</p>
          <ul>
            {conflicts.map(([a, b]) => (
              <li key={`${a}-${b}`}>{conflictText(a, b)}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions start">
        <button type="button" className="primary" onClick={() => void save()} disabled={!dirty || conflicts.length > 0} data-testid="shortcuts-save">
          {t('common.save')}
        </button>
        <button type="button" onClick={() => (setDraft(effectiveShortcuts([])), setProblem(null), setJustSaved(false))} disabled={isDefault} data-testid="shortcuts-reset">
          {t('shortcuts.resetAll')}
        </button>
        <span className="status" role="status">
          {justSaved && !dirty ? t('common.saved') : ''}
        </span>
      </div>
      {error ? <ErrorNote testId="shortcuts-error">{saveErrorText(error)}</ErrorNote> : null}
    </section>
  );
}
