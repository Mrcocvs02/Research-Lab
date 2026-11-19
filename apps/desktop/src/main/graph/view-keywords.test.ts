import { taxonomyFileSchema } from '@rl/core';
import { describe, expect, it } from 'vitest';
import { keywordTagIds } from './view.js';

const n = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id, parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });

describe('keywordTagIds', () => {
  it('the Keywords root and everything under it, nothing else', () => {
    const tax = taxonomyFileSchema.parse({ nodes: [n('kw', { family: 'keywords' }), n('raw-word', { parents: ['kw'] }), n('deep-word', { parents: ['raw-word'] }), n('topic', { family: 'many' }), n('area', { parents: ['topic'] })] });
    expect([...keywordTagIds(tax)].sort()).toEqual(['deep-word', 'kw', 'raw-word']);
    expect(keywordTagIds(null).size).toBe(0);
  });
});
