import { describe, expect, it } from 'vitest';
import { honoursProfileSwitch, mustRefuseDebugSwitches } from './debug-switches.js';

describe('debug switches of the installed app', () => {
  const port = ['app.exe', '--remote-debugging-port=9333'];
  it('an installed build refuses the debugging port and pipe', () => {
    expect(mustRefuseDebugSwitches(true, false, port)).toBe(true);
    expect(mustRefuseDebugSwitches(true, false, ['app.exe', '--remote-debugging-pipe'])).toBe(true);
    expect(mustRefuseDebugSwitches(true, false, ['app.exe'], (n) => n === 'remote-debugging-port')).toBe(true);
    expect(mustRefuseDebugSwitches(true, false, ['app.exe', '--remote-debugging-portal'])).toBe(false);
  });
  it('a test build and a development run accept them', () => {
    expect(mustRefuseDebugSwitches(true, true, port)).toBe(false);
    expect(mustRefuseDebugSwitches(false, false, port)).toBe(false);
  });
  it('the profile switch is ignored only by an installed non-test build', () => {
    expect(honoursProfileSwitch(true, false)).toBe(false);
    expect(honoursProfileSwitch(true, true)).toBe(true);
    expect(honoursProfileSwitch(false, false)).toBe(true);
  });
});
