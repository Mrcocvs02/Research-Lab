import { Component, lazy, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import i18n, { loadStrings, type StringPart } from '../i18n';

/**
 * `React.lazy` that retries the import once before failing (a chunk can miss a read for a moment, for example while the
 * disk is busy); a second failure reaches the nearest `ErrorBoundary`. `delayMs` is the pause before the retry.
 */
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, delayMs = 250) {
  return lazy(() => load().catch(() => new Promise<{ default: T }>((resolve, reject) => setTimeout(() => load().then(resolve, reject), delayMs))));
}

/**
 * A lazy view: its code and the strings parts it uses (`i18n/locales/parts`) load together, so the first render has all
 * its texts. Every key a file uses is in the core or in the parts of each lazy view that includes the file (tested).
 */
export function lazyView<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, parts: readonly StringPart[]) {
  return lazyRetry(() => Promise.all([load(), loadStrings(parts)]).then(([m]) => m));
}

// Built in, for when the dictionary chunk is the one that failed to load: the boundary must still speak.
const BUILT_IN = {
  it: { message: 'Una parte dell’app non si è caricata. Ricarica la finestra per riprovare.', reload: 'Ricarica' },
  en: { message: 'A part of the app could not be loaded. Reload the window to try again.', reload: 'Reload' },
} as const;

function text(key: 'message' | 'reload'): string {
  const lang = (i18n.language || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en').toLowerCase().startsWith('it') ? 'it' : 'en';
  try {
    if (i18n.isInitialized) {
      if (key === 'message' && i18n.exists('errors.chunkLoad')) return i18n.t('errors.chunkLoad');
      if (key === 'reload' && i18n.exists('common.reload')) return i18n.t('common.reload');
    }
  } catch {
    /* the built-in text below */
  }
  return BUILT_IN[lang][key];
}

interface BoundaryProps {
  children: ReactNode;
}

/** Shows a message and a "Reload" button instead of a white window when something below fails to load or render. */
export class ErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('renderer failure', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="boot" role="alert" data-testid="load-error">
        <p>{text('message')}</p>
        <button type="button" onClick={() => location.reload()} data-testid="reload-button">
          {text('reload')}
        </button>
      </div>
    );
  }
}

/** Lazy content: nothing while it loads, the error boundary if it cannot. */
export function Lazy({ children }: BoundaryProps) {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>{children}</Suspense>
    </ErrorBoundary>
  );
}
