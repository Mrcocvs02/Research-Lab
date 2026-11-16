/**
 * Chromium features that cost memory or background work in a desktop app that has one window, no network
 * pages and no media (docs/DECISIONS.md, D-170). None of them touches isolation, the sandbox or the CSP.
 */
export const DISABLED_FEATURES = [
  // A spare renderer process kept ready for the next navigation: this app never navigates to another site.
  'SpareRendererForSitePerProcess',
  // Page translation (needs network and a model download), never offered in the app window.
  'Translate',
  // Chromecast discovery (network scans in the background).
  'MediaRouter',
  // Fetching optimisation hints from Google servers; the app is offline-first.
  'OptimizationHints',
] as const;

interface CommandLine {
  appendSwitch(name: string, value?: string): void;
}

/** Applies the resource switches; call before the `ready` event of the app. */
export function applyResourceSwitches(commandLine: CommandLine): void {
  commandLine.appendSwitch('disable-features', DISABLED_FEATURES.join(','));
}
