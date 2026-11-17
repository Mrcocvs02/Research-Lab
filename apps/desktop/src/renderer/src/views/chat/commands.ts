import type { ShortcutId } from '@rl/core';

/**
 * The predefined commands of the palette (plan §5). Their label and prompt are translated (`chat.commands.<id>`); the
 * user's own come from `commands:list`. A command only fills the prompt: sending is always a separate action.
 */
export const PREDEFINED_COMMANDS = ['describe', 'tags', 'related', 'readNext', 'summarizeSelection', 'updateProject', 'whatsNew', 'secondBrain'] as const;
/** Commands of the palette that open a dialog instead of filling the prompt (label: `chat.commands.<id>.label`). */
export const ACTION_COMMANDS = ['exportDialog'] as const;
export type PredefinedCommand = (typeof PREDEFINED_COMMANDS)[number];

/**
 * App actions of the palette (D-262): go to a view, new library, back up now, settings, guide, the shortcut list,
 * switch language. `shortcut` is the command whose accelerator is shown next to the label.
 */
export const APP_ACTIONS = [
  { id: 'goLibrary', shortcut: 'nav.library' },
  { id: 'goProjects', shortcut: 'nav.projects' },
  { id: 'goNetwork', shortcut: 'nav.network' },
  { id: 'goInbox', shortcut: 'nav.inbox' },
  { id: 'goReview', shortcut: 'nav.review' },
  { id: 'goSettings', shortcut: 'nav.settings' },
  { id: 'newLibrary' },
  { id: 'backupNow' },
  { id: 'openGuide', shortcut: 'guide.open' },
  { id: 'showShortcuts', shortcut: 'shortcuts.show' },
  { id: 'switchLanguage' },
] as const satisfies ReadonlyArray<{ id: string; shortcut?: ShortcutId }>;
export type AppActionId = (typeof APP_ACTIONS)[number]['id'];

export interface PaletteItem {
  id: string;
  label: string;
  prompt: string;
  /** From the user's `commands/` folder. */
  custom: boolean;
  /** Opens a dialog instead of filling the prompt. */
  action?: (typeof ACTION_COMMANDS)[number];
  /** An app action (view, backup, guide...) instead of a prompt. */
  appAction?: AppActionId;
  /** Command whose accelerator is shown next to the label. */
  shortcut?: ShortcutId;
}
