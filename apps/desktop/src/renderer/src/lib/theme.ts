/** Explicit theme choice (`system` follows the OS). Kept tiny: it is part of the first screen. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** Applies the choice to the document: the CSS tokens follow `data-theme`, `system` leaves them to the OS preference. */
export function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === 'system') {
    delete root.dataset.theme;
    root.style.colorScheme = '';
  } else {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }
  window.dispatchEvent(new Event('rl:theme'));
}

/** True when the window is drawn dark (explicit choice first, then the OS preference); canvases use it. */
export function isDarkTheme(): boolean {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'dark') return true;
  if (explicit === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}
