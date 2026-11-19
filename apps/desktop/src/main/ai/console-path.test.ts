import { describe, expect, it } from 'vitest';
import { realIo } from './account.js';

describe('the login console', () => {
  it('refuses a program path that is not absolute (it would be looked up in the working folder or the PATH)', () => {
    expect(() => realIo().openConsole('claude', ['auth', 'login'], {})).toThrow(/absolute/);
  });
});
