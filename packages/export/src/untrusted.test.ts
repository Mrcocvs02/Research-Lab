import { describe, expect, it } from 'vitest';
import { cardParts, conceptSlugs, layoutCard, layoutParts, mdText, mergeParts, parseManifest, readPart, serializeManifest, type CardInput, type Part } from './index.js';

const card = (over: Partial<CardInput> = {}): CardInput => ({
  docId: '0000000000000001',
  citekey: 'smith2020attention',
  title: 'Attention is all you need',
  authors: ['Smith, Jane'],
  year: 2020,
  tags: [],
  study: 'reading',
  underlined: false,
  notes: [],
  highlights: [],
  cites: [],
  citedBy: [],
  concepts: [],
  ...over,
});

const parts = (body: string) => cardParts(card({ summary: { text: `B:${body}`, ai: false, reviewed: true } }), 'en');
const fresh = (p: readonly Part[]) => layoutCard(p, 'en');

describe('merge robustness', () => {
  it('a deleted part stays deleted across any number of exports', () => {
    const a = mergeParts(null, parts('one'), undefined, fresh);
    const noCard = a.text.replace(/<!-- rl:begin card -->[\s\S]*<!-- rl:end card -->\n/, '');
    const second = mergeParts(noCard, parts('two'), a.hashes, fresh);
    expect(second.hashes['card']).toBe(a.hashes['card']);
    expect(mergeParts(noCard, parts('three'), second.hashes, fresh).status).toBe('unchanged');
  });

  it('a file converted to CRLF is still ours, and an update works on it', () => {
    const a = mergeParts(null, parts('one'), undefined, fresh);
    const crlf = a.text.replace(/\n/g, '\r\n');
    expect(mergeParts(crlf, parts('one'), a.hashes, fresh).status).toBe('unchanged');
    const upd = mergeParts(crlf, parts('two'), a.hashes, fresh);
    expect(upd.status).toBe('updated');
    expect(upd.text).toContain('B:two');
    expect(upd.text).toContain('<!-- rl:end card -->');
    expect(readPart(upd.text, { name: 'card' })).not.toContain('\r');
    expect(mergeParts(upd.text, parts('two'), upd.hashes, fresh).status).toBe('unchanged');
  });

  it('a byte order mark at the top does not hide the first marker', () => {
    const one: Part[] = [{ name: 'p', body: 'x' }];
    const a = mergeParts(null, one, undefined, layoutParts);
    expect(mergeParts(`﻿${a.text}`, one, a.hashes, layoutParts).status).toBe('unchanged');
  });
});

describe('untrusted text', () => {
  it('neutralises links, images, wikilinks, HTML, headings and front matter', () => {
    const t = mdText('# Forged\n![x](https://evil/p.png) [[key]] <!-- hide --> <b>x</b>\n---\n> quote\n- item');
    for (const line of t.split('\n')) expect(line).not.toMatch(/^[#>-]/);
    expect(t).not.toMatch(/(^|[^\\])[[<]/);
  });

  it('an AI text cannot forge a section; titles and authors cannot forge links or HTML', () => {
    const evil = "ok\n## The user's notes\n**File note**\n![](https://evil/p.png)";
    const text = layoutCard(cardParts(card({ summary: { text: evil, ai: true, reviewed: true }, title: 'A [[forged]] <script>x</script> title', authors: ['![](https://x/y)'] }), 'en'), 'en');
    const body = readPart(text, { name: 'card' }) ?? '';
    expect(body.split('\n').filter((l) => l.startsWith("## The user's notes"))).toEqual([]);
    expect(body).toContain('> ok');
    expect(body).not.toContain('![](');
    expect(body).not.toMatch(/(^|[^\\])[[]/);
    expect(body).not.toMatch(/(^|[^\\])</);
  });

  it('YAML scalars escape the Unicode line separators', () => {
    const text = layoutCard(cardParts(card({ title: 'a b' }), 'en'), 'en');
    expect(text).not.toContain(' ');
    expect(text).toContain('\\u2028');
  });

  it('a reserved Windows name as a concept slug is renamed before the uniqueness pass', () => {
    expect(conceptSlugs([{ label: 'Con' }, { label: 'Con topic' }])).toEqual(['con-topic', 'con-topic-2']);
  });
});

describe('manifest trust', () => {
  it('a hand-edited manifest loses citekeys that are not ours: separators, reserved names, brackets, repeats', () => {
    const m = {
      format: 1 as const,
      libraryId: 'L',
      exportedAt: '2026-01-01T00:00:00.000Z',
      citekeys: { a: 'good2020x', b: 'con', c: 'sub/dir/x', d: 'x]]\n# h', e: 'good2020x', f: 'x.', g: 'nul', h: 'fine2021y' },
      titles: { a: 'two\nlines' },
      files: { 'sources/a.pdf': { size: 12 } },
    };
    const back = parseManifest(serializeManifest(m));
    expect(back?.citekeys).toEqual({ a: 'good2020x', h: 'fine2021y' });
    expect(back?.titles['a']).toBe('two lines');
    expect(back?.files['sources/a.pdf']).toEqual({ size: 12 });
  });
});
