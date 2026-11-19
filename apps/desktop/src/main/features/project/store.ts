import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { claimSchema, documentIdSchema, itemIdSchema, outlineSchema, type Claim, type Evidence, type Outline } from '@rl/core';
import { atomicWriteFile, atomicWriteJson } from '@rl/core/node';

/**
 * What the Schema tab of a project keeps, in the data folder, as Markdown the user could read (X7):
 * `projects/<id>/outline.md` (the "Ricerca" part), `projects/<id>/claims/<id>.md`, `projects/<id>/reports/<YYYY-MM-DD>.md` and
 * `projects/<id>/project.json` (the consent to send paragraphs, D-423). The model never writes any of these files itself.
 */
const dirOf = (dataDir: string, projectId: string): string => path.join(dataDir, 'projects', itemIdSchema.parse(projectId));

const SECTIONS = ['Idea', 'Domande', 'Ipotesi', 'Piano'] as const;
/** A line of free text that would read as a section heading is kept apart by a backslash. */
const esc = (t: string): string => t.replace(/^(#{1,2} )/gm, '\\$1');
const unesc = (t: string): string => t.replace(/^\\(#{1,2} )/gm, '$1');
const oneLine = (t: string): string => t.replace(/\s+/g, ' ').trim();

export function serializeOutline(o: Outline): string {
  const qs = o.questions.map((q) => `- [${q.id}] ${oneLine(q.text)}${q.sources.map((d) => `\n  - fonte: ${d}`).join('')}`).join('\n');
  return `## Idea\n${esc(o.idea.trim())}\n\n## Domande\n${qs}\n\n## Ipotesi\n${o.hypotheses.map((h) => `- ${oneLine(h)}`).join('\n')}\n\n## Piano\n${esc(o.plan.trim())}\n`;
}

export function parseOutline(raw: string): Outline | null {
  const parts = new Map<string, string>();
  let cur: string | null = null;
  const buf: string[] = [];
  const flush = () => cur !== null && parts.set(cur, buf.join('\n').trim());
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m && (SECTIONS as readonly string[]).includes(m[1]!)) {
      flush();
      cur = m[1]!;
      buf.length = 0;
    } else buf.push(line);
  }
  flush();
  if (parts.size === 0) return null;
  const questions: Outline['questions'] = [];
  for (const line of (parts.get('Domande') ?? '').split('\n')) {
    const q = /^- \[([a-z0-9]{1,24})\] (.+)$/.exec(line);
    const s = /^\s+- fonte: ([0-9a-f]{16})$/.exec(line);
    if (q) questions.push({ id: q[1]!, text: q[2]!, sources: [] });
    else if (s && questions.length > 0) questions[questions.length - 1]!.sources.push(s[1]!);
  }
  const hypotheses = (parts.get('Ipotesi') ?? '').split('\n').map((l) => /^- (.+)$/.exec(l)?.[1]).filter((h): h is string => !!h);
  const r = outlineSchema.safeParse({ idea: unesc(parts.get('Idea') ?? ''), questions, hypotheses, plan: unesc(parts.get('Piano') ?? '') });
  return r.success ? r.data : null;
}

export async function readOutline(dataDir: string, projectId: string): Promise<Outline | null> {
  const raw = await readFile(path.join(dirOf(dataDir, projectId), 'outline.md'), 'utf8').catch(() => null);
  return raw === null ? null : parseOutline(raw);
}

export async function writeOutline(dataDir: string, projectId: string, o: Outline): Promise<void> {
  const d = dirOf(dataDir, projectId);
  await mkdir(d, { recursive: true });
  await atomicWriteFile(path.join(d, 'outline.md'), serializeOutline(o));
}

const STANCE_LABEL = { supports: 'sostiene', contradicts: 'contraddice' } as const;
const EVIDENCE = /^- (sostiene|contraddice): \[[^\]]*\]\(lab:\/\/doc\/([0-9a-f]{16})\?page=(\d+)(?:&ann=([a-z0-9._-]+))?\)(?: «(.*)»)?$/;

export const evidenceLine = (e: Evidence): string => `- ${STANCE_LABEL[e.stance]}: [p. ${e.page}](lab://doc/${e.docId}?page=${e.page}${e.annId ? `&ann=${e.annId}` : ''})${e.excerpt ? ` «${oneLine(e.excerpt).replace(/[«»]/g, '"')}»` : ''}`;

export function serializeClaim(c: Claim): string {
  return `---\nid: ${c.id}\nquestion: ${c.questionId ?? ''}\n---\n${oneLine(c.text)}\n\n## Prove\n${c.evidence.map(evidenceLine).join('\n')}\n`;
}

export function parseClaim(raw: string): Claim | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const head = new Map(m[1]!.split(/\r?\n/).map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()] as const));
  const [text = '', rest = ''] = m[2]!.split(/\r?\n## Prove\r?\n/);
  const evidence = rest.split(/\r?\n/).flatMap((l) => {
    const e = EVIDENCE.exec(l);
    return e ? [{ docId: e[2]!, page: Number(e[3]), ...(e[4] ? { annId: e[4] } : {}), stance: e[1] === 'sostiene' ? ('supports' as const) : ('contradicts' as const), excerpt: e[5] ?? '' }] : [];
  });
  const r = claimSchema.safeParse({ id: head.get('id'), questionId: head.get('question') || null, text: text.trim(), evidence });
  return r.success ? r.data : null;
}

export async function listClaims(dataDir: string, projectId: string): Promise<Claim[]> {
  const d = path.join(dirOf(dataDir, projectId), 'claims');
  const names = (await readdir(d).catch(() => [] as string[])).filter((n) => n.endsWith('.md')).sort();
  const out: Claim[] = [];
  for (const n of names.slice(0, 500)) {
    const c = parseClaim(await readFile(path.join(d, n), 'utf8').catch(() => ''));
    if (c) out.push(c);
  }
  return out;
}

export async function writeClaim(dataDir: string, projectId: string, c: Claim): Promise<void> {
  const d = path.join(dirOf(dataDir, projectId), 'claims');
  await mkdir(d, { recursive: true });
  await atomicWriteFile(path.join(d, `${itemIdSchema.parse(c.id)}.md`), serializeClaim(c));
}

export async function removeClaim(dataDir: string, projectId: string, id: string): Promise<boolean> {
  const f = path.join(dirOf(dataDir, projectId), 'claims', `${itemIdSchema.parse(id)}.md`);
  const had = await readFile(f).then(() => true, () => false);
  await rm(f, { force: true });
  return had;
}

export async function listReports(dataDir: string, projectId: string): Promise<Array<{ date: string; title: string }>> {
  const d = path.join(dirOf(dataDir, projectId), 'reports');
  const names = (await readdir(d).catch(() => [] as string[])).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort().reverse();
  const out: Array<{ date: string; title: string }> = [];
  for (const n of names.slice(0, 100)) {
    const body = await readFile(path.join(d, n), 'utf8').catch(() => '');
    out.push({ date: n.slice(0, 10), title: (body.split('\n').find((l) => l.trim() !== '') ?? n).replace(/^#+\s*/, '').trim().slice(0, 120) });
  }
  return out;
}

const reportFile = (dataDir: string, projectId: string, date: string): string => path.join(dirOf(dataDir, projectId), 'reports', `${date}.md`);
export const readReport = async (dataDir: string, projectId: string, date: string): Promise<string | null> => readFile(reportFile(dataDir, projectId, date), 'utf8').catch(() => null);
export async function writeReport(dataDir: string, projectId: string, date: string, body: string): Promise<void> {
  await mkdir(path.dirname(reportFile(dataDir, projectId, date)), { recursive: true });
  // The report of the same day that is replaced is kept once, as `<date>.prev.md` (I1); it is not listed.
  const before = await readReport(dataDir, projectId, date);
  if (before !== null) await atomicWriteFile(path.join(path.dirname(reportFile(dataDir, projectId, date)), `${date}.prev.md`), before);
  await atomicWriteFile(reportFile(dataDir, projectId, date), body.endsWith('\n') ? body : `${body}\n`);
}

/** The consent "Send my paragraphs to Claude" of a project: `projects/<id>/project.json`, `aiParagraphConsentAt`. */
export async function readConsent(dataDir: string, projectId: string): Promise<string | null> {
  try {
    const v = JSON.parse(await readFile(path.join(dirOf(dataDir, projectId), 'project.json'), 'utf8')) as { aiParagraphConsentAt?: unknown };
    return typeof v.aiParagraphConsentAt === 'string' && !Number.isNaN(Date.parse(v.aiParagraphConsentAt)) ? v.aiParagraphConsentAt : null;
  } catch {
    return null;
  }
}

export async function writeConsent(dataDir: string, projectId: string, granted: boolean): Promise<string | null> {
  const d = dirOf(dataDir, projectId);
  await mkdir(d, { recursive: true });
  const at = granted ? new Date().toISOString() : null;
  await atomicWriteJson(path.join(d, 'project.json'), at ? { aiParagraphConsentAt: at } : {});
  return at;
}

export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 24);
export const docIdOk = (id: string): boolean => documentIdSchema.safeParse(id).success;
