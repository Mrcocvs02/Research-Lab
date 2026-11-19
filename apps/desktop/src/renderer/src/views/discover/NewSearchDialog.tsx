import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DISCOVER_LIMITS, type Channels, type DiscoverKind, type ResponseOf } from '@rl/core';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { SelectField, TextField } from '../../components/ui';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import type { Launch } from './Searches';

type Project = ResponseOf<Channels, 'projects:list'>['items'][number];

/**
 * "New search" (§17.4.17): the one question each kind needs. A question; or a project to extend the bibliography of; or two
 * projects to find a bridge between (a selection of documents starts from the Library without this dialog). Nothing is sent
 * until "Search"; the search itself needs no Claude.
 */
export function NewSearchDialog({ kind, onStart, onClose }: { kind: DiscoverKind; onStart(l: Omit<Launch, 'nonce'>): void; onClose(): void }) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [query, setQuery] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  useEffect(() => {
    if (kind === 'question') return;
    let live = true;
    rl.invoke('projects:list', {}).then(
      (r) => live && setProjects(r.items),
      () => live && setProjects([]),
    );
    return () => {
      live = false;
    };
  }, [kind]);
  const ready = kind === 'question' ? query.trim().length > 0 : kind === 'extend' ? a !== '' : a !== '' && b !== '' && a !== b;
  const go = () => onStart(kind === 'question' ? { kind, query: query.trim() } : kind === 'extend' ? { kind, a: { docIds: [], projectId: a } } : { kind, a: { docIds: [], projectId: a }, b: { docIds: [], projectId: b } });
  const picker = (label: string, value: string, set: (v: string) => void, testId: string) => (
    <SelectField label={label} value={value} onChange={(e) => set(e.target.value)} data-testid={testId}>
      <option value="">{t('discover.new.choose')}</option>
      {(projects ?? []).map((p) => (
        <option key={p.id} value={p.id}>
          {safeText(p.name)}
        </option>
      ))}
    </SelectField>
  );
  return (
    <Dialog title={t(`discover.new.title_${kind}`)} onClose={onClose} testId="new-search-dialog">
      <div className="dlg-scroll source-form">
        <p className="hint">{t(`discover.new.hint_${kind}`)}</p>
        {kind === 'question' && <TextField label={t('discover.new.question')} value={query} maxLength={DISCOVER_LIMITS.queryChars} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ready && go()} data-testid="new-search-query" />}
        {kind === 'extend' && picker(t('discover.new.project'), a, setA, 'new-search-project')}
        {kind === 'bridge' && (
          <>
            {picker(t('discover.new.sideA'), a, setA, 'new-search-side-a')}
            {picker(t('discover.new.sideB'), b, setB, 'new-search-side-b')}
          </>
        )}
      </div>
      <div className="actions dlg-foot">
        <Button onClick={onClose}>{t('discover.cancel')}</Button>
        <Button variant="primary" disabled={!ready} onClick={go} data-testid="new-search-go">
          {t('discover.new.search')}
        </Button>
      </div>
    </Dialog>
  );
}
