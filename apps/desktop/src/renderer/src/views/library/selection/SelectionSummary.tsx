import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { groupTagLabel } from '@rl/core';
import { Button } from '../../../components/Button';
import { safeText } from '../safeText';
import { TagChip, TagPicker } from '../TagParts';
import { resolveId } from '../taxonomyModel';
import { useTagActions } from '../useTagActions';
import { useTaxonomy } from '../useTaxonomy';
import type { DocRow } from '../useDocumentList';
import { summarizeSelection, type Count } from './summaryModel';

const SOME_FIRST = 10;

interface Props {
  docIds: string[];
  rows: DocRow[];
  onNeedRows?(): void;
  onProject(): void;
  onClose(): void;
}

/** A field that differs between the documents: "k different", opened to the values with "n of total". */
function Mixed({ name, values, total }: { name: string; values: Count[]; total: number }) {
  const { t } = useTranslation();
  return (
    <details className="sel-mixed" data-testid={`sel-field-${name}`} data-mixed="1">
      <summary>{t('library.sel.different', { count: values.length })}</summary>
      <ul>
        {values.slice(0, 10).map((v) => (
          <li key={v.value}>
            {safeText(v.value)} <span className="facet-count">{t('library.sel.nOf', { n: v.n, total })}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Field({ name, label, children }: { name: string; label: string; children: ReactNode }) {
  return (
    <div className="sel-field" data-testid={`sel-field-${name}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The panel of a multiple selection (D-500): only what the documents share, summarised, never one list per document;
 * batch tag actions. It replaces the old tag editor, which listed the union of the tags.
 */
export default function SelectionSummary({ docIds, rows, onNeedRows, onProject, onClose }: Props) {
  const { t } = useTranslation();
  const { model } = useTaxonomy();
  const { tag, createAndAdd, busy } = useTagActions();
  const [all, setAll] = useState(false);

  // Actions follow the selected ids; the summary comes from the rows loaded so far, so ask for the rest.
  useEffect(() => {
    if (rows.length < docIds.length) onNeedRows?.();
  }, [rows.length, docIds.length, onNeedRows]);

  const s = useMemo(() => summarizeSelection(rows), [rows]);
  const total = s.total;
  const label = (id: string) => model.byId.get(resolveId(model, id))?.label ?? groupTagLabel(id);
  const color = (id: string) => model.byId.get(resolveId(model, id))?.color;
  const some = all ? s.tagsSome : s.tagsSome.slice(0, SOME_FIRST);

  return (
    <div className="doc-card-panel sel-summary" data-testid="bulk-panel" aria-busy={busy}>
      <header className="panel-head">
        <div className="panel-title">
          <h2 data-testid="bulk-title">{t('bulk.title', { count: docIds.length })}</h2>
        </div>
        <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {total > 0 && (
        <dl className="sel-fields">
          {s.type.same !== null ? (
            <Field name="type" label={t('library.sel.type')}>
              {safeText(s.type.same)}
            </Field>
          ) : s.type.values.length > 0 ? (
            <div className="sel-field">
              <dt>{t('library.sel.type')}</dt>
              <dd>
                <Mixed name="type" values={s.type.values} total={total} />
              </dd>
            </div>
          ) : null}
          {s.years && (
            <Field name="years" label={t('library.sel.years')}>
              {s.years.min === s.years.max ? s.years.min : `${s.years.min}–${s.years.max}`}
            </Field>
          )}
          <Field name="authors" label={t('library.sel.authors')}>
            {s.authors.length > 0 ? safeText(s.authors.slice(0, 5).join(', ')) + (s.authors.length > 5 ? ' …' : '') : t('library.sel.none')}
          </Field>
          {s.folder !== '' && (
            <Field name="folder" label={t('library.sel.folder')}>
              {safeText(s.folder)}
            </Field>
          )}
          <Field name="status" label={t('library.sel.status')}>
            {s.status.map((x) => t(`library.sel.state.${x.state}`, { count: x.n })).join(' · ')}
          </Field>
        </dl>
      )}
      <section className="panel-section" data-testid="sel-tags-all">
        <h3>{t('library.sel.tagsAll', { count: s.tagsAll.length })}</h3>
        {s.tagsAll.length === 0 ? (
          <p className="hint">{t('library.sel.noneShared')}</p>
        ) : (
          <div className="sel-chips">
            {s.tagsAll.map((id) => (
              <TagChip key={id} id={id} label={label(id)} color={color(id)} removeLabel={t('library.sel.removeAll', { name: label(id) })} onRemove={busy ? undefined : () => void tag(docIds, { remove: [id] })} testId="sel-tag-all" />
            ))}
          </div>
        )}
        <TagPicker
          model={model}
          ariaLabel={t('tags.add')}
          placeholder={t('library.sel.addAll')}
          onPick={(id) => void tag(docIds, { add: [id] })}
          onCreate={(text) => createAndAdd(docIds, text)}
          testId="bulk-tag-input"
          disabled={busy}
        />
        {busy && (
          <p className="hint" role="status" data-testid="bulk-busy">
            {t('bulk.working', { count: docIds.length })}
          </p>
        )}
      </section>
      {s.tagsSome.length > 0 && (
        <details className="panel-section" data-testid="sel-tags-some">
          <summary>{t('library.sel.tagsSome', { count: s.tagsSome.length })}</summary>
          <ul className="sel-some">
            {some.map((c) => (
              <li key={c.value} data-testid="sel-tag-some-row" data-tag={c.value}>
                <TagChip id={c.value} label={label(c.value)} color={color(c.value)} />
                <span className="facet-count">{t('library.sel.nOf', { n: c.n, total })}</span>
                <button type="button" className="link" disabled={busy} onClick={() => void tag(docIds, { add: [c.value] })} data-testid="sel-tag-some-add">
                  {t('library.sel.addToOthers', { count: total - c.n })}
                </button>
                <button type="button" className="link" disabled={busy} onClick={() => void tag(docIds, { remove: [c.value] })} data-testid="sel-tag-some-remove">
                  {t('library.sel.remove')}
                </button>
              </li>
            ))}
          </ul>
          {!all && s.tagsSome.length > SOME_FIRST && (
            <button type="button" className="link" onClick={() => setAll(true)}>
              {t('library.sel.showAll', { count: s.tagsSome.length })}
            </button>
          )}
        </details>
      )}
      <div className="sel-actions">
        <Button size="sm" onClick={onProject} data-testid="sel-project">
          {t('library.sel.toProject')}
        </Button>
      </div>
    </div>
  );
}
