import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import { createMemoryLogger, redactFields } from './log.js';
import { isAllowedExternalUrl } from './security.js';

describe('errors', () => {
  it('round-trips through JSON', () => {
    const e = new AppError('NOT_FOUND', 'x', { a: 1 });
    expect(AppError.from(JSON.parse(JSON.stringify(e)))).toMatchObject({ code: 'NOT_FOUND', message: 'x', details: { a: 1 } });
  });
  it('wraps unknown errors as INTERNAL', () => {
    expect(AppError.from(new Error('x')).code).toBe('INTERNAL');
  });
});

describe('log redaction', () => {
  it('redacts keys, tokens and text, truncates long strings', () => {
    const out = redactFields({ apiKey: 'sk-1', token: 't', text: 'doc text', nested: { password: 'p', ok: 'fine' }, long: 'x'.repeat(2000) }) as Record<string, unknown>;
    expect(out.apiKey).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.text).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).password).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).ok).toBe('fine');
    expect(String(out.long).length).toBeLessThan(600);
  });
  it('memory logger redacts and scopes', () => {
    const l = createMemoryLogger('a');
    l.child('b').info('hi', { secret: 's' });
    expect(l.entries[0]).toMatchObject({ scope: 'a.b', fields: { secret: '[redacted]' } });
  });
});

describe('external URL allowlist', () => {
  it('allows https on allowed hosts and subdomains only', () => {
    expect(isAllowedExternalUrl('https://doi.org/10.1/x')).toBe(true);
    expect(isAllowedExternalUrl('https://export.arxiv.org/abs/1')).toBe(true);
    expect(isAllowedExternalUrl('http://doi.org/x')).toBe(false);
    expect(isAllowedExternalUrl('https://evil-doi.org/x')).toBe(false);
    expect(isAllowedExternalUrl('https://doi.org.evil.com/x')).toBe(false);
    expect(isAllowedExternalUrl('https://user:pw@doi.org/x')).toBe(false);
    expect(isAllowedExternalUrl('file:///c:/x')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
  });
});
