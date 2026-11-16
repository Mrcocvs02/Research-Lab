// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@rl/core';
import i18n from '../i18n';
import { errorMessage } from '../lib/errors';
import { ErrorBoundary, Lazy, lazyRetry } from './Lazy';

const Ok = () => createElement('p', { 'data-testid': 'ok' }, 'loaded');
const Bomb = (): never => {
  throw new Error('boom');
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ErrorBoundary', () => {
  it('shows a localized message and a Reload button that reloads the window', async () => {
    await i18n.changeLanguage('it');
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(createElement(ErrorBoundary, null, createElement(Bomb)));
    expect(screen.getByRole('alert').textContent).toContain('Ricarica');
    fireEvent.click(screen.getByTestId('reload-button'));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('speaks even when the dictionary did not load (built-in text)', async () => {
    const saved = i18n.isInitialized;
    vi.spyOn(i18n, 'exists').mockReturnValue(false);
    await i18n.changeLanguage('en');
    render(createElement(ErrorBoundary, null, createElement(Bomb)));
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded/);
    expect(screen.getByTestId('reload-button').textContent).toBe('Reload');
    expect(saved).toBe(true);
  });

  it('renders children when nothing fails', () => {
    render(createElement(ErrorBoundary, null, createElement(Ok)));
    expect(screen.getByTestId('ok')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('lazyRetry', () => {
  it('retries a failed import once and then renders', async () => {
    let calls = 0;
    const C = lazyRetry(() => (++calls === 1 ? Promise.reject(new Error('chunk')) : Promise.resolve({ default: Ok })), 5);
    render(createElement(Lazy, null, createElement(C)));
    expect(await screen.findByTestId('ok')).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('fails to the boundary after the second failure (no endless retries)', async () => {
    let calls = 0;
    const C = lazyRetry(() => (calls++, Promise.reject(new Error('chunk'))), 5);
    render(createElement(Lazy, null, createElement(C)));
    expect(await screen.findByTestId('load-error')).toBeTruthy();
    expect(calls).toBe(2);
  });
});

describe('errorMessage for a change that may be incomplete (D-182)', () => {
  it('is localized in both languages', async () => {
    const e = new AppError('CONFLICT', 'partial', { reason: 'partial-group' });
    await i18n.changeLanguage('en');
    expect(errorMessage(e, i18n.t.bind(i18n) as never)).toMatch(/cannot be undone/);
    await i18n.changeLanguage('it');
    expect(errorMessage(e, i18n.t.bind(i18n) as never)).toMatch(/non si può annullare/);
  });
});
