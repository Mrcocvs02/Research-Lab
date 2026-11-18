import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SHORTCUT_COMMANDS, SHORTCUT_IDS, effectiveShortcuts, findShortcutConflicts, normalizeReaderToolKey, type ShortcutId, type ShortcutOverride, type ShortcutScope } from '@rl/core';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { IconMore } from '../components/icons';
import { Kbd } from '../components/Kbd';
import { Menu } from '../components/Menu';
import { ErrorNote } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { FIXED_ACCELERATORS, eventAccelerator } from '../lib/keymap';
import { RlError } from '../lib/rl-error';
import { rl } from '../lib/rl';
import { useApp } from '../state/app-context';
import { Group, SavedMark, SectionHead } from './rows';
import { useAutoSave } from './useAutoSave';
import './shortcuts.css';

const SCOPES: readonly ShortcutScope[] = ['global', 'reader', 'reader-tool'];

/** Overrides to save: only the commands whose accelerator differs from the default (an empty list = all defaults). */
export function overridesOf(effective: Record<ShortcutId, string | null>): ShortcutOverride[] {
  return SHORTCUT_IDS.filter((id) => effective[id] !== SHORTCUT_COMMANDS[id].default).map((id) => ({ id, accelerator: effective[id] }));
}

/**
 * The key of a key press for a command of the `reader-tool` scope: a bare key (a letter, a digit, Space, Delete), validated by
 * `normalizeReaderToolKey` of the core; Ctrl, Alt or Meta make it refused. null for a lone modifier (still waiting), `'modifier'`
 * for a combination, `'invalid'` for any other key.
 */
export function readerToolKeyOf(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): string | null | 'modifier' | 'invalid' {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return null;
  if (e.ctrlKey || e.altKey || e.metaKey) return 'modifier';
  return normalizeReaderToolKey(e.key === ' ' ? 'Space' : e.key) ?? 'invalid';
}

interface RowProps {
  id: ShortcutId;
  label: string;
  accel: string | null;
  recording: boolean;
  conflict: boolean;
  note: string | undefined;
  onRecord(): void;
  onKey(e: ReactKeyboardEvent): void;
  onCancel(): void;
  onSet(accel: string | null): void;
}

/** One command (40 px): its name, its key (or the recorder, in the same space) and a menu with Change… / Turn off / Restore the default. */
function ShortcutRow({ id, label, accel, recording, conflict, note, onRecord, onKey, onCancel, onSet }: RowProps) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLSpanElement>(null);
  const recorder = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (recording) recorder.current?.focus();
  }, [recording]);
  const def = SHORTCUT_COMMANDS[id].default;
  const menuLabel = t('shortcuts.actionsFor', { command: label });
  return (
    <>
      <tr data-testid="shortcut-row" data-command={id} data-conflict={conflict || undefined} data-changed={accel !== def || undefined}>
        <th scope="row">{label}</th>
        <td className="shortcut-key">
          {recording ? (
            <button type="button" ref={recorder} className="shortcut-recorder" onKeyDown={onKey} onBlur={onCancel} data-testid="shortcut-recorder" aria-label={t('shortcuts.recordingLabel', { command: label })}>
              {t('shortcuts.recording')}
            </button>
          ) : accel ? (
            <Kbd data-testid="shortcut-key">{accel}</Kbd>
          ) : (
            <span className="muted" data-testid="shortcut-key">
              {t('shortcuts.off')}
            </span>
          )}
        </td>
        <td className="shortcut-act">
          <span ref={more}>
            <IconButton label={menuLabel} size="sm" onClick={() => setMenu(true)} data-testid="shortcut-more">
              <IconMore size={16} />
            </IconButton>
          </span>
          <Menu
            anchor={more}
            open={menu}
            onClose={() => setMenu(false)}
            label={menuLabel}
            groups={[
              {
                id: 'cmd',
                items: [
                  { id: 'change', label: t('shortcuts.change'), onSelect: onRecord },
                  accel === null ? { id: 'off', label: t('shortcuts.turnOff'), disabled: true, disabledReason: t('shortcuts.alreadyOff'), onSelect: () => {} } : { id: 'off', label: t('shortcuts.turnOff'), onSelect: () => onSet(null) },
                  accel === def ? { id: 'default', label: t('shortcuts.default'), disabled: true, disabledReason: t('shortcuts.alreadyDefault'), onSelect: () => {} } : { id: 'default', label: t('shortcuts.defaultKey', { key: def }), onSelect: () => onSet(def) },
                ],
              },
            ]}
          />
        </td>
      </tr>
      {note && (
        <tr className="shortcut-note">
          <td colSpan={3}>
            <span className="field-error" role="alert" data-testid={conflict ? undefined : 'shortcut-problem'}>
              {note}
            </span>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The keyboard shortcuts editor (D-257, 4.17): the commands by place (everywhere, reader, reader tools), each with its key.
 * "Change…" records the next key press (Esc cancels), a change that creates no conflict is saved at once; two commands on one
 * key are shown under their rows and nothing is saved until it is solved. Fixed keys (Esc, Enter, arrows, Ctrl+A/C/V/X) cannot
 * be assigned; the reader tools use single keys. "Undo changes" goes back to the state when the page was opened.
 */
export function ShortcutsSection() {
  const { t } = useTranslation();
  const app = useApp();
  const saved = app.settings?.shortcuts;
  const [draft, setDraft] = useState<Record<ShortcutId, string | null>>(() => effectiveShortcuts(saved ?? []));
  const opening = useRef(draft);
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [problem, setProblem] = useState<{ id: ShortcutId; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const save = useAutoSave();

  // The saved list reaches the draft again after a save or a restore of the settings (an unsolved conflict stays on screen).
  useEffect(() => setDraft((d) => (findShortcutConflicts(d).length > 0 ? d : effectiveShortcuts(saved ?? []))), [saved]);

  const conflicts = useMemo(() => findShortcutConflicts(draft), [draft]);
  const conflicting = useMemo(() => new Set(conflicts.flat()), [conflicts]);
  const isDefault = SHORTCUT_IDS.every((id) => draft[id] === SHORTCUT_COMMANDS[id].default);
  const changedSinceOpening = SHORTCUT_IDS.some((id) => draft[id] !== opening.current[id]);

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

  /** Shows the new state and saves it unless it holds a conflict (then it waits for the fix). */
  const apply = (next: Record<ShortcutId, string | null>) => {
    setDraft(next);
    setProblem(null);
    if (findShortcutConflicts(next).length > 0) return;
    void save.run(async () => {
      await rl.invoke('settings:set', { shortcuts: overridesOf(next) });
      await app.refresh();
    });
  };
  const set = (id: ShortcutId, accelerator: string | null) => apply({ ...draft, [id]: accelerator });

  const onRecordKey = (id: ShortcutId, e: ReactKeyboardEvent) => {
    // The key press belongs to the recorder: no command of the window may answer it.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return setRecording(null);
    if (SHORTCUT_COMMANDS[id].scope === 'reader-tool') {
      const key = readerToolKeyOf(e.nativeEvent);
      if (key === null) return;
      if (key === 'modifier' || key === 'invalid') return setProblem({ id, text: t(key === 'modifier' ? 'shortcuts.bareKey' : 'shortcuts.bareInvalid') });
      set(id, key);
      return setRecording(null);
    }
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

  const q = query.trim().toLowerCase();
  const visible = (id: ShortcutId) => q === '' || label(id).toLowerCase().includes(q) || (draft[id] ?? '').toLowerCase().includes(q);
  const conflictText = (id: ShortcutId) => {
    const other = conflicts.find((c) => c.includes(id))?.find((x) => x !== id);
    return other ? t('shortcuts.conflict', { a: label(id), b: label(other), key: draft[id] ?? '' }) : undefined;
  };

  return (
    <div data-testid="shortcuts-section" data-set="shortcuts">
      <SectionHead title={t('shortcuts.title')} intro={t('shortcuts.intro')} />
      <input type="search" className="shortcut-search" aria-label={t('shortcuts.search')} placeholder={t('shortcuts.search')} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="shortcuts-search" />
      {SCOPES.map((scope) => {
        const ids = SHORTCUT_IDS.filter((id) => SHORTCUT_COMMANDS[id].scope === scope && visible(id));
        if (ids.length === 0) return null;
        return (
          <Group key={scope} title={t(`shortcuts.scope.${scope}`)}>
            <p className="set-help">{t(`shortcuts.scopeHint.${scope}`)}</p>
            <table className="shortcut-table shortcut-grid" data-testid={`shortcuts-${scope}`}>
              <caption className="sr-only">{t(`shortcuts.scope.${scope}`)}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t('shortcuts.command')}</th>
                  <th scope="col">{t('shortcuts.key')}</th>
                  <th scope="col">{t('shortcuts.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {ids.map((id) => (
                  <ShortcutRow
                    key={id}
                    id={id}
                    label={label(id)}
                    accel={draft[id]}
                    recording={recording === id}
                    conflict={conflicting.has(id)}
                    note={problem?.id === id ? problem.text : conflicting.has(id) ? conflictText(id) : undefined}
                    onRecord={() => (setProblem(null), setRecording(id))}
                    onKey={(e) => onRecordKey(id, e)}
                    onCancel={() => setRecording((cur) => (cur === id ? null : cur))}
                    onSet={(a) => set(id, a)}
                  />
                ))}
              </tbody>
            </table>
          </Group>
        );
      })}
      <p className="set-help">{t('shortcuts.fixed')}</p>
      {conflicts.length > 0 && (
        <p className="field-error" role="alert" data-testid="shortcuts-conflicts">
          {t('shortcuts.conflictsTitle')}
        </p>
      )}
      <div className="actions start">
        <Button size="sm" onClick={() => apply({ ...opening.current })} disabled={!changedSinceOpening} data-testid="shortcuts-undo">
          {t('shortcuts.undoChanges')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => apply(effectiveShortcuts([]))} disabled={isDefault} data-testid="shortcuts-reset">
          {t('shortcuts.resetAll')}
        </Button>
        <SavedMark save={save} />
      </div>
      {save.state === 'error' ? <ErrorNote testId="shortcuts-error">{saveErrorText(save.error)}</ErrorNote> : null}
    </div>
  );
}
