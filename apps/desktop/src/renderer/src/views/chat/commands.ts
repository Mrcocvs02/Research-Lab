/**
 * The predefined commands of the palette (plan §5). Their label and prompt are translated (`chat.commands.<id>`); the
 * user's own come from `commands:list`. A command only fills the prompt: sending is always a separate action.
 */
export const PREDEFINED_COMMANDS = ['describe', 'tags', 'related', 'readNext', 'summarizeSelection', 'updateProject', 'whatsNew', 'secondBrain'] as const;
/** Commands of the palette that open a dialog instead of filling the prompt (label: `chat.commands.<id>.label`). */
export const ACTION_COMMANDS = ['exportDialog'] as const;
export type PredefinedCommand = (typeof PREDEFINED_COMMANDS)[number];

export interface PaletteItem {
  id: string;
  label: string;
  prompt: string;
  /** From the user's `commands/` folder. */
  custom: boolean;
  /** Opens a dialog instead of filling the prompt. */
  action?: (typeof ACTION_COMMANDS)[number];
}
