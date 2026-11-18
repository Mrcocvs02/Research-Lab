import { describe, expect, it } from 'vitest';
import { CROP_MAX_BYTES, isWebp } from './index.js';

describe('crops', () => {
  it('accepts only WebP bytes', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
    expect(isWebp(webp)).toBe(true);
    expect(isWebp(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(isWebp(new Uint8Array(4))).toBe(false);
  });
  it('keeps a crop under 300 KB', () => {
    expect(CROP_MAX_BYTES).toBe(300 * 1024);
  });
});
