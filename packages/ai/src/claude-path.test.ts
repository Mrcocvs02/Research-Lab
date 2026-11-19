import { describe, expect, it } from 'vitest';
import { findClaudeExecutable } from './claude.js';

const base = { env: { PATH: '' }, home: '/h', platform: 'linux' as const, bundled: () => null };

describe('the configured Claude Code path', () => {
  it('is used when absolute and named claude', () => {
    expect(findClaudeExecutable({ ...base, configured: '/opt/tools/claude', exists: () => true })).toEqual({ path: '/opt/tools/claude', source: 'settings' });
  });
  it('is ignored when relative or when it names another program', () => {
    expect(findClaudeExecutable({ ...base, configured: 'claude', exists: (p) => p === 'claude' }).source).toBe('none');
    expect(findClaudeExecutable({ ...base, configured: '/tmp/evil.sh', exists: (p) => p === '/tmp/evil.sh' }).source).toBe('none');
  });
  it('accepts claude.exe on Windows', () => {
    expect(findClaudeExecutable({ ...base, platform: 'win32', configured: 'C:\\Tools\\Claude.exe', exists: () => true }).source).toBe('settings');
    expect(findClaudeExecutable({ ...base, platform: 'win32', configured: '.\\claude.exe', exists: (p) => p === '.\\claude.exe' }).source).toBe('none');
  });
});
