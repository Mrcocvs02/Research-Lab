import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MainServices } from '../../ipc/handlers/services.js';
import { realign, type Section } from './align.js';
import { parseDocxXml, parseMarkdown, texPlain } from './headings.js';
import { assign, getManuscript, moveAssignments, setManuscript } from './index.js';
import { readSource } from './source.js';

const D1 = '0123456789abcdef';
const D2 = 'fedcba9876543210';

describe('markdown', () => {
  it('reads ATX and setext headings, skipping front matter and fenced code', () => {
    const md = ['---', 'title: x', '---', '# One', 'text', '```', '# not a heading', '```', 'Two', '===', '', '### Deep **bold** [link](http://x)', '###### Deepest', 'Plain', '---', '| a | b |', '|---|---|'].join('\n');
    expect(parseMarkdown(md)).toEqual([
      { title: 'One', level: 1 },
      { title: 'Two', level: 1 },
      { title: 'Deep bold link', level: 3 },
      { title: 'Deepest', level: 4 },
      { title: 'Plain', level: 2 },
    ]);
  });
});

describe('latex titles', () => {
  it('reduces commands to their text', () => {
    expect(texPlain('A \\emph{strong} \\textbf{claim}\\label{s:a} and 50\\% of~it')).toBe('A strong claim and 50% of it');
  });
});

describe('docx xml', () => {
  const para = (text: string, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const styles = '<w:styles><w:style w:type="paragraph" w:styleId="H1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="T2"><w:name w:val="Titolo 2"/></w:style><w:style w:type="paragraph" w:styleId="Custom"><w:name w:val="My"/><w:basedOn w:val="Out"/></w:style><w:style w:type="paragraph" w:styleId="Out"><w:name w:val="Outlined"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style></w:styles>';
  it('takes levels from the paragraph, the style chain and the style names', () => {
    const doc = `<w:document><w:body>${para('Intro &amp; aims', '<w:pStyle w:val="H1"/>')}${para('Body')}${para('Method', '<w:pStyle w:val="T2"/>')}${para('Custom one', '<w:pStyle w:val="Custom"/>')}${para('Own', '<w:outlineLvl w:val="0"/>')}${para('Not a heading', '<w:outlineLvl w:val="9"/>')}</w:body></w:document>`;
    expect(parseDocxXml(doc, styles)).toEqual([
      { title: 'Intro & aims', level: 1 },
      { title: 'Method', level: 2 },
      { title: 'Custom one', level: 3 },
      { title: 'Own', level: 1 },
    ]);
  });
});

describe('realign', () => {
  const sec = (id: string, title: string, level: number, order: number): Section => ({ id, title, level, order });
  const old = [sec('a', 'Introduction', 1, 0), sec('b', 'Motivation', 2, 1), sec('c', 'Method', 1, 2), sec('d', 'Results', 1, 3)];
  let n = 0;
  const mk = () => `new${n++}`;
  it('keeps ids across a rename, a new section and a vanished one that had assignments', () => {
    const r = realign(old, [{ title: 'Introduction', level: 1 }, { title: 'Motivations', level: 2 }, { title: 'Methods', level: 1 }, { title: 'Brand new', level: 1 }], (id) => id === 'd', mk);
    expect(r.sections.map((s) => [s.id, s.gone ?? false])).toEqual([['a', false], ['b', false], ['c', false], ['new0', false], ['d', true]]);
    expect(r.changes).toEqual({ added: 1, renamed: 2, removed: 1 });
  });
  it('drops a vanished section without assignments and matches a changed level by title', () => {
    const r = realign(old, [{ title: 'introduction', level: 2 }, { title: 'Method', level: 1 }], () => false, mk);
    expect(r.sections.map((s) => s.id)).toEqual(['a', 'c']);
    expect(r.changes).toEqual({ added: 0, renamed: 0, removed: 2 });
  });
});

describe('files and project state', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ms-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('follows includes only inside the folder of the file, with the limits reported', async () => {
    await mkdir(path.join(dir, 'main', 'chap'), { recursive: true });
    await mkdir(path.join(dir, 'outside'), { recursive: true });
    await writeFile(path.join(dir, 'outside', 'secret.tex'), '\\section{Leaked}');
    await mkdir(path.join(dir, 'main'), { recursive: true });
    await writeFile(path.join(dir, 'main', 'chap', 'a.tex'), '\\section{Alpha}\n% \\section{Commented}\n\\subsection*[short]{Beta \\emph{two}}\n\\input{chap/b}');
    await writeFile(path.join(dir, 'main', 'chap', 'b.tex'), '\\subsubsection{Gamma}');
    await writeFile(path.join(dir, 'main', 'main.tex'), '\\section{Preamble ignored}\\begin{document}\n\\input{chap/a}\n\\include{../outside/secret}\n\\input{missing}\n\\section{Last}\n\\end{document}');
    const r = await readSource(path.join(dir, 'main', 'main.tex'));
    expect(r.headings).toEqual([{ title: 'Alpha', level: 1 }, { title: 'Beta two', level: 2 }, { title: 'Gamma', level: 3 }, { title: 'Last', level: 1 }]);
    expect(r.read).toEqual({ files: 3, total: 3 });
  });

  it('reads a docx written with a minimal ZIP', async () => {
    const xml = '<w:document><w:body><w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Chapter</w:t></w:r></w:p></w:body></w:document>';
    const f = path.join(dir, 'x.docx');
    await writeFile(f, zipSync({ 'word/document.xml': strToU8(xml), 'docProps/other.xml': strToU8('x') }));
    expect((await readSource(f)).headings).toEqual([{ title: 'Chapter', level: 1 }]);
  });

  const services = (picked: string | null): MainServices => {
    const projects = { get: async () => ({ id: 'p1' }) };
    return {
      localDataDir: path.join(dir, 'local'),
      emit: () => undefined,
      pickFile: async () => picked,
      approved: { add: () => undefined },
      runtime: { require: async () => ({ libraryId: 'lib1', store: { dataDir: path.join(dir, 'data'), projects } }) },
    } as unknown as MainServices;
  };

  it('links a file, realigns when it changes and keeps orphan assignments; the file is never written', async () => {
    const file = path.join(dir, 'thesis.md');
    await writeFile(file, '# Intro\n## Why\n# Method\n');
    const s = services(file);
    const first = await setManuscript(s, { projectId: 'p1', source: { kind: 'file' } });
    const [intro, why] = first.manuscript!.sections;
    await assign(s, { projectId: 'p1', sectionId: why!.id, refs: [{ kind: 'doc', docId: D1 }, { kind: 'ann', docId: D2, annId: 'a1', page: 3 }], on: true, origin: 'user' });
    await assign(s, { projectId: 'p1', sectionId: intro!.id, refs: [{ kind: 'doc', docId: D1 }], on: true, origin: 'user' });
    const same = await getManuscript(s, { projectId: 'p1' });
    expect(same.changes).toBeUndefined();
    expect(same.file).toMatchObject({ state: 'ok', name: 'thesis.md' });

    await writeFile(file, '# Intro\n# Method\n# Extra\n');
    await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const after = await getManuscript(s, { projectId: 'p1' });
    expect(after.changes).toEqual({ added: 1, renamed: 0, removed: 1 });
    const orphan = after.manuscript!.sections.find((x) => x.gone);
    expect(orphan?.id).toBe(why!.id);
    expect(after.manuscript!.assignments.filter((a) => a.sectionId === why!.id)).toHaveLength(2);

    const moved = await moveAssignments(s, { projectId: 'p1', from: why!.id, to: intro!.id });
    expect(moved.manuscript.sections.some((x) => x.gone)).toBe(false);
    expect(moved.manuscript.assignments.filter((a) => a.sectionId === intro!.id)).toHaveLength(2); // the paper both had is not doubled

    await rm(file);
    expect((await getManuscript(s, { projectId: 'p1' })).file?.state).toBe('missing');
  });

  it('keeps ids of sections written in the app and unlinks', async () => {
    const s = services(null);
    const a = await setManuscript(s, { projectId: 'p1', source: { kind: 'app', sections: [{ title: 'One', level: 1 }, { title: 'Two', level: 2 }] } });
    const [one, two] = a.manuscript!.sections;
    await assign(s, { projectId: 'p1', sectionId: two!.id, refs: [{ kind: 'claim', claimId: 'c1' }], on: true, origin: 'user' });
    const b = await setManuscript(s, { projectId: 'p1', source: { kind: 'app', sections: [{ id: one!.id, title: 'One renamed', level: 1 }, { id: two!.id, title: 'Two renamed', level: 2 }] } });
    expect(b.manuscript!.sections.map((x) => x.id)).toEqual([one!.id, two!.id]);
    expect(b.manuscript!.assignments).toHaveLength(1);
    const off = await assign(s, { projectId: 'p1', sectionId: two!.id, refs: [{ kind: 'claim', claimId: 'c1' }], on: false, origin: 'user' });
    expect(off.manuscript.assignments).toHaveLength(0);
    expect(await setManuscript(s, { projectId: 'p1', source: { kind: 'none' } })).toEqual({ manuscript: null, file: null });
    expect(await getManuscript(s, { projectId: 'p1' })).toEqual({ manuscript: null, file: null });
  });
});
