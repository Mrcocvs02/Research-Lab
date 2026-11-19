import { describe, expect, it } from 'vitest';
import { prepare } from './NoteRich';

const ID = '0123456789abcdef';

describe('preparing a note for the preview', () => {
  it('swaps formulas for placeholders in reading order and keeps their source', () => {
    const p = prepare('a $x^2$ b\n$$\\frac{a}{b}$$\nc $y$');
    expect(p.maths).toEqual([
      { tex: 'x^2', display: false },
      { tex: '\\frac{a}{b}', display: true },
      { tex: 'y', display: false },
    ]);
    expect(p.text).toContain('[x](math:0)');
    expect(p.text).toContain('[x](math:1)');
    expect(p.text).toContain('[x](math:2)');
    expect(p.text).not.toContain('$');
  });

  it('leaves formulas and links inside code as they are written', () => {
    const src = `use \`$x$\` and \`[[T|lab://doc/${ID}]]\`\n\`\`\`\n$$y$$\n\`\`\``;
    const p = prepare(src);
    expect(p.maths).toEqual([]);
    expect(p.text).toBe(src);
    expect(p.docIds).toEqual([]);
  });

  it('turns a [[ link into a Markdown link by identifier and lists what to look up, so the title shown is the current one', () => {
    const p = prepare(`see [[Old [title|lab://doc/${ID}?page=3]] and [[Plan|lab://project/p-1]] and [[Plan again|lab://project/p-1]]`);
    expect(p.text).toBe(`see [Old  title](lab://doc/${ID}?page=3) and [Plan](lab://project/p-1) and [Plan again](lab://project/p-1)`);
    expect(p.docIds).toEqual([ID]);
    expect(p.projectIds).toEqual(['p-1']);
  });

  it('does not take a link to anything else for a link of the lab', () => {
    const p = prepare('[[x|https://example.com]] [[y|lab://doc/zz]]');
    expect(p.docIds).toEqual([]);
    expect(p.text).toContain('[[x|https://example.com]]');
  });
});
