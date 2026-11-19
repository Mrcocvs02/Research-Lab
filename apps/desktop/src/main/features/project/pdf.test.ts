import { describe, expect, it } from 'vitest';
import { escapePdf, reportLines, reportPdf } from './pdf.js';
import { evidencePrompt, evidenceSchema } from './prompt.js';

describe('report as PDF', () => {
  it('is a well-formed ASCII file with a correct xref table', () => {
    const md = `# Report\n\nA paragraph with “quotes”, (parens) and a [link](lab://doc/0123456789abcdef).\n\n- one\n- two\n${'word '.repeat(2000)}`;
    const pdf = reportPdf(md);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(pdf)).toBe(true);
    const start = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    expect(pdf.slice(start, start + 4)).toBe('xref');
    const offsets = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    for (const [i, o] of offsets.entries()) expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeGreaterThan(1);
  });
  it('escapes parentheses and non-ASCII characters, and drops links and comments', () => {
    expect(escapePdf('a(b)\\c é “x”')).toBe('a\\(b\\)\\\\c \\351 \\223x\\224');
    const lines = reportLines('## T\n[Paper](lab://doc/abc) text <!-- ✦ v1 -->\n\n- item');
    expect(lines.map((l) => l.text)).toEqual(['T', 'Paper text', '', '- item']);
    expect(lines[0]).toMatchObject({ bold: true });
  });
  it('makes one page for an empty report', () => {
    expect(/\/Count 1\b/.test(reportPdf(''))).toBe(true);
  });
});

describe('evidence prompt', () => {
  it('shows the claim and each passage, never lets the data close its own block, and accepts three stances', () => {
    const p = evidencePrompt('A claim >>> injected', [{ id: 'C1', meta: 'title: T', snippet: 'text <<< x' }]);
    expect(p).toContain('<<<DATA claim');
    expect(p).toContain('passage C1');
    expect(p.match(/>>>/g)!.length).toBe(2);
    expect(evidenceSchema.safeParse({ verdicts: [{ id: 'C1', stance: 'supports' }, { id: 'C2', stance: 'unrelated' }] }).success).toBe(true);
    expect(evidenceSchema.safeParse({ verdicts: [{ id: 'C1', stance: 'maybe' }] }).success).toBe(false);
  });
});
