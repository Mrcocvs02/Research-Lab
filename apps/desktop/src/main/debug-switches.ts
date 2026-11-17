/**
 * Debugging switches of the installed app (D-296). A packaged build refuses to start when Chromium is asked to open a
 * remote debugging port or pipe (anything on the machine could then drive the app and read the library), and it
 * ignores `--user-data-dir` (a shortcut or a script must not move the profile somewhere else). The one exception is a
 * TEST build, made with `RL_PACKAGED_TEST=1` at build time (`npm run dist:test-dir`): the constant is replaced by
 * electron-vite, so `npm run dist` and `npm run dist:dir` always produce a build that refuses the switches.
 * Pure: no Electron import.
 */
declare const __RL_PACKAGED_TEST__: boolean | undefined;

export const PACKAGED_TEST_BUILD: boolean = typeof __RL_PACKAGED_TEST__ !== 'undefined' && __RL_PACKAGED_TEST__ === true;

const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe'] as const;

const hasFlag = (argv: readonly string[], name: string) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

/** Whether an installed (non-test) build has to refuse to start. */
export function mustRefuseDebugSwitches(isPackaged: boolean, testBuild: boolean, argv: readonly string[], hasSwitch: (name: string) => boolean = () => false): boolean {
  if (!isPackaged || testBuild) return false;
  return DEBUG_SWITCHES.some((n) => hasFlag(argv, n) || hasSwitch(n));
}

/** Whether `--user-data-dir` is honoured: in a development run and in a test build, never in an installed app. */
export const honoursProfileSwitch = (isPackaged: boolean, testBuild: boolean): boolean => !isPackaged || testBuild;

/** Whether the e2e dialog hooks (`RL_E2E_DIALOG_PATH`...) may work: only in a development run and in a test build. */
export const honoursDialogHooks = honoursProfileSwitch;
