import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { safeText } from './safeText';
import { TagChip, TagPicker } from './TagParts';
import { familyOps, tagFamilies } from './taxonomyModel';
import { useTaxonomy } from './useTaxonomy';

/**
 * Tag families (D-491): named sets of tags that the Map's "Group by" offers. A family is the grouping hint `extra:<Name>` on its tags;
 * a tag nested under another (set in the node editor, "Parents") rolls up to the family member above it. Create, rename, add or remove tags.
 */
export function TaxonomyFamilies() {
  const { t } = useTranslation();
  const { model, apply, labelOf, colorOf } = useTaxonomy();
  const families = useMemo(() => tagFamilies(model.nodes), [model]);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const shown = [...families.map((f) => f.name), ...draft.filter((d) => !families.some((f) => f.name === d))];

  const create = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || shown.some((x) => x.toLowerCase() === n.toLowerCase())) return;
    setDraft((d) => [...d, n]);
    setName('');
  };
  const rename = async (from: string, to: string) => {
    const next = to.trim();
    setRenaming(null);
    if (!next || next === from) return;
    const members = families.find((f) => f.name === from)?.members ?? [];
    if (members.length === 0) setDraft((d) => d.map((x) => (x === from ? next : x)));
    else await apply(familyOps(model, members, next));
  };

  return (
    <details className="types-venues" data-testid="tax-families">
      <summary>{t('tax.families')}</summary>
      <p className="hint">{t('tax.familiesHint')}</p>
      {shown.map((fam) => {
        const members = families.find((f) => f.name === fam)?.members ?? [];
        return (
          <div className="field" key={fam} data-testid="tax-family" data-family={fam}>
            {renaming?.from === fam ? (
              <input
                type="text"
                autoFocus
                maxLength={90}
                value={renaming.to}
                aria-label={t('tax.familyRename')}
                onChange={(e) => setRenaming({ from: fam, to: e.target.value })}
                onBlur={() => void rename(fam, renaming.to)}
                onKeyDown={(e) => e.key === 'Enter' && void rename(fam, renaming.to)}
                data-testid="tax-family-rename-input"
              />
            ) : (
              <span className="label">
                {safeText(fam)}{' '}
                <button type="button" className="link" onClick={() => setRenaming({ from: fam, to: fam })} data-testid="tax-family-rename">
                  {t('tax.familyRename')}
                </button>
              </span>
            )}
            <div className="tag-list">
              {members.length === 0 && <span className="hint">{t('tax.familyEmpty')}</span>}
              {members.map((id) => (
                <TagChip key={id} id={id} label={labelOf(id)} color={colorOf(id)} removeLabel={t('tax.familyRemove', { name: labelOf(id) })} onRemove={() => void apply(familyOps(model, [id], null))} />
              ))}
            </div>
            <TagPicker
              model={model}
              exclude={new Set(members)}
              ariaLabel={t('tax.familyAdd', { family: fam })}
              placeholder={t('tax.familyAddPlaceholder')}
              onPick={(id) => void apply(familyOps(model, [id], fam)).then(() => setDraft((d) => d.filter((x) => x !== fam)))}
              testId="tax-family-add"
            />
          </div>
        );
      })}
      <form className="inline-form" onSubmit={create}>
        <input type="text" value={name} maxLength={90} aria-label={t('tax.familyNew')} placeholder={t('tax.familyNew')} onChange={(e) => setName(e.target.value)} data-testid="tax-family-new" />
        <button type="submit" disabled={!name.trim()}>
          {t('tax.add')}
        </button>
      </form>
    </details>
  );
}
