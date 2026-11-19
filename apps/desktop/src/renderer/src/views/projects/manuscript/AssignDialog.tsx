import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Claim, Manuscript, ManuscriptRef } from '@rl/core';
import { Button } from '../../../components/Button';
import { Chip } from '../../../components/Chip';
import { Dialog } from '../../../components/Dialog';
import { rl } from '../../../lib/rl';
import { useNotify } from '../../../lib/notify';
import { safeText } from '../../library/safeText';
import { liveSections, refKey, type Paper } from './manuscriptModel';

type Kind = 'doc' | 'ann' | 'note' | 'claim';
const KINDS: readonly Kind[] = ['doc', 'ann', 'note', 'claim'];
const SHOWN = 200;
const BATCH = 6;
interface Item {
  key: string;
  kind: Kind;
  ref: ManuscriptRef;
  label: string;
}

/**
 * "Assign" (§18.1): the papers of the project, their highlights and notes, and the claims, to put in one section (several at once);
 * or, with `docId`, the section to put one paper in; or, with `moveFrom`, the section that takes what a vanished section held.
 * Highlights and notes of every paper are read only when their filter is turned on.
 */
export default function AssignDialog({
  projectId,
  papers,
  claims,
  section,
  existing,
  docId,
  moveFrom,
  onClose,
  onDone,
}: {
  projectId: string;
  papers: readonly Paper[];
  claims: readonly Claim[];
  section?: { id: string; title: string } | undefined;
  existing?: ReadonlySet<string> | undefined;
  docId?: string | undefined;
  moveFrom?: string | undefined;
  onClose(): void;
  onDone(m: Manuscript): void;
}) {
  const { t } = useTranslation();
  const { reportError, info } = useNotify();
  const picking = section === undefined;
  const [sections, setSections] = useState<Manuscript['sections'] | null>(null);
  const [target, setTarget] = useState('');
  const [query, setQuery] = useState('');
  const [on, setOn] = useState<ReadonlySet<Kind>>(new Set<Kind>(['doc', 'claim']));
  const [extra, setExtra] = useState<Item[]>([]);
  const loaded = useRef(new Set<Kind>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!picking) return;
    void rl.invoke('project:manuscript', { projectId }).then((r) => setSections(r.manuscript ? liveSections(r.manuscript) : []), reportError);
  }, [picking, projectId, reportError]);

  // Highlights and notes: read when their chip is first turned on, a few papers at a time.
  useEffect(() => {
    if (picking) return;
    const want = (['ann', 'note'] as const).filter((k) => on.has(k) && !loaded.current.has(k));
    if (want.length === 0) return;
    for (const k of want) loaded.current.add(k);
    void (async () => {
      for (let i = 0; i < papers.length && mounted.current; i += BATCH) {
        const found = await Promise.all(
          papers.slice(i, i + BATCH).map(async (p) => {
            const out: Item[] = [];
            const name = safeText(p.title);
            if (want.includes('ann')) {
              const r = await rl.invoke('annotations:list', { docId: p.docId });
              for (const a of r.annotations) out.push({ key: `ann:${p.docId}:${a.id}`, kind: 'ann', ref: { kind: 'ann', docId: p.docId, annId: a.id, page: a.page }, label: `▌ «${safeText(a.text ?? a.comment ?? '').slice(0, 90)}» · ${name} ${t('ms.page', { n: a.page })}` });
            }
            if (want.includes('note')) {
              const r = await rl.invoke('notes:list', { docId: p.docId });
              for (const n of r.items) out.push({ key: `note:${p.docId}:${n.page ?? ''}`, kind: 'note', ref: { kind: 'note', docId: p.docId, ...(n.page ? { page: n.page } : {}) }, label: `✎ ${n.page ? t('ms.notePage', { n: n.page }) : t('ms.noteFile')} · ${name}: ${safeText(n.excerpt).slice(0, 80)}` });
            }
            return out;
          }),
        ).catch((e: unknown) => (reportError(e), [] as Item[][]));
        if (mounted.current) setExtra((cur) => [...cur, ...found.flat()]);
      }
    })();
  }, [on, papers, picking, reportError, t]);

  const items = useMemo(() => {
    const base: Item[] = [
      ...papers.map((p): Item => ({ key: `doc:${p.docId}`, kind: 'doc', ref: { kind: 'doc', docId: p.docId }, label: `📄 ${safeText(p.title)}${p.year ? ` (${p.year})` : ''}` })),
      ...claims.map((c): Item => ({ key: `claim:${c.id}`, kind: 'claim', ref: { kind: 'claim', claimId: c.id }, label: `◆ «${safeText(c.text).slice(0, 120)}»` })),
      ...extra,
    ];
    const q = query.trim().toLowerCase();
    return base.filter((i) => on.has(i.kind) && (q === '' || i.label.toLowerCase().includes(q)));
  }, [papers, claims, extra, on, query]);

  const done = (m: Manuscript) => {
    onDone(m);
    onClose();
  };
  const run = async (op: () => Promise<{ manuscript: Manuscript }>) => {
    setBusy(true);
    try {
      done((await op()).manuscript);
    } catch (e) {
      reportError(e);
      setBusy(false);
    }
  };
  const submit = () => {
    if (moveFrom !== undefined) return run(() => rl.invoke('project:moveAssignments', { projectId, from: moveFrom, to: target }));
    if (section === undefined) return run(() => rl.invoke('project:assign', { projectId, sectionId: target, refs: [{ kind: 'doc', docId: docId ?? '' }], on: true })).then(() => info(t('ms.assigned')));
    const refs = items.filter((i) => picked.has(i.key)).map((i) => i.ref).slice(0, 200);
    return run(() => rl.invoke('project:assign', { projectId, sectionId: section.id, refs, on: true }));
  };

  const title = moveFrom !== undefined ? t('ms.reassignTitle') : picking ? t('ms.pickSection', { title: safeText(papers.find((p) => p.docId === docId)?.title ?? '') }) : t('ms.assignTitle', { section: safeText(section.title) });
  return (
    <Dialog title={title} onClose={onClose} testId="ms-assign-dialog">
      {picking ? (
        <div className="dlg-scroll">
          <div className="field">
            <label htmlFor="ms-target">{t('ms.section')}</label>
            <select id="ms-target" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="ms-target">
              <option value="">{t('ms.noSection')}</option>
              {(sections ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {`${'– '.repeat(s.level - 1)}${safeText(s.title)}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <>
          <div className="field">
            <input type="search" value={query} placeholder={t('ms.assignSearch')} aria-label={t('ms.assignSearch')} onChange={(e) => setQuery(e.target.value)} data-testid="ms-assign-search" />
          </div>
          <div className="ms-chips" role="group" aria-label={t('ms.assignFilters')}>
            {KINDS.map((k) => (
              <Chip key={k} selected={on.has(k)} onClick={() => setOn((cur) => new Set(on.has(k) ? [...cur].filter((x) => x !== k) : [...cur, k]))}>
                {t(`ms.group.${k}`)}
              </Chip>
            ))}
          </div>
          <ul className="dlg-scroll ms-assign-list">
            {items.length === 0 && <li className="hint">{t('ms.assignNone')}</li>}
            {items.slice(0, SHOWN).map((i) => {
              const had = existing?.has(refKey(i.ref)) ?? false;
              return (
                <li key={i.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={had || picked.has(i.key)}
                      disabled={had}
                      onChange={(e) => setPicked((cur) => new Set(e.target.checked ? [...cur, i.key] : [...cur].filter((x) => x !== i.key)))}
                      data-testid="ms-assign-item"
                    />{' '}
                    {i.label}
                    {had && <span className="hint"> · {t('ms.assignedAlready')}</span>}
                  </label>
                </li>
              );
            })}
            {items.length > SHOWN && <li className="hint">{t('ms.assignMore', { count: SHOWN })}</li>}
          </ul>
        </>
      )}
      <div className="actions">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={busy || (picking ? target === '' : picked.size === 0)} onClick={() => void submit()} data-testid="ms-assign-ok">
          {picking ? t('ms.assignDo') : t('ms.assignN', { count: Math.min(picked.size, 200) })}
        </Button>
      </div>
    </Dialog>
  );
}
