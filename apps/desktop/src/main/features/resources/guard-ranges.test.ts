import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from './guard.js';
import { loadPreview } from './preview.js';

describe('more non-public ranges', () => {
  it.each(['192.0.0.8', '198.18.0.1', '198.19.255.1', '192.0.2.1', '198.51.100.7', '203.0.113.9', 'fec0::1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '2002:7f00:1::1', '2002:0a00:0001::', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '::10.0.0.1', '[::1]', 'fe80::1', 'ff02::1', 'fd12::1'])('%s is private', (a) => {
    expect(isPrivateAddress(a)).toBe(true);
  });
  it.each(['8.8.8.8', '93.184.216.34', '198.20.0.1', '2606:4700:4700::1111', '2002:0808:0808::1', '64:ff9b::808:808'])('%s is public', (a) => {
    expect(isPrivateAddress(a)).toBe(false);
  });
});

describe('a name that resolves differently on the second look', () => {
  const page = (() => Promise.resolve(new Response('<title>t</title>', { headers: { 'content-type': 'text/html' } }))) as unknown as typeof fetch;
  it('is refused (DNS rebinding)', async () => {
    const answers = [['93.184.216.34'], ['127.0.0.1']];
    await expect(loadPreview('https://rebind.example/x', { fetch: page, resolve: async () => answers.shift() ?? ['127.0.0.1'] })).rejects.toMatchObject({ reason: 'refused' });
  });
  it('is read when both answers agree', async () => {
    const r = await loadPreview('https://stable.example/x', { fetch: page, resolve: async () => ['93.184.216.34'] });
    expect(r.title).toBe('t');
  });
});
