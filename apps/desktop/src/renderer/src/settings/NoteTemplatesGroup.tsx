import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Channels, ResponseOf } from '@rl/core';
import { useNotify } from '../lib/notify';
import { rl } from '../lib/rl';
import { Group, Row } from './rows';
import { useAutoSave } from './useAutoSave';

type Template = ResponseOf<Channels, 'templates:list'>['items'][number];

/**
 * Settings › Library › "Note templates" (feature 35, §17.4.6): the `.md` files of the data folder with placeholders
 * `{{titolo}}`, `{{autori}}`, `{{anno}}`, `{{evidenziazioni}}`. The "Letteratura" template is the one the literature note uses
 * (its seven sections, editable). Saved when a field loses the focus, like every setting (D-336).
 */
export function NoteTemplatesGroup() {
  const { t } = useTranslation();
  const { reportError } = useNotify();
  const save = useAutoSave();
  const [items, setItems] = useState<Template[]>([]);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');

  const load = useCallback(
    async (select?: string) => {
      try {
        const r = await rl.invoke('templates:list', {});
        setItems(r.items);
        const cur = r.items.find((x) => x.id === (select ?? id)) ?? r.items[0];
        if (cur) {
          setId(cur.id);
          setName(cur.name);
          setBody(cur.body);
        }
      } catch (e) {
        reportError(e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = items.find((x) => x.id === id);
  const commit = () => {
    if (!current || name.trim() === '' || (name === current.name && body === current.body)) return;
    void save.run(async () => {
      const r = await rl.invoke('templates:save', { id: current.id, name: name.trim(), body });
      await load(r.item.id);
    });
  };
  const add = () =>
    void save.run(async () => {
      const r = await rl.invoke('templates:save', { name: t('settings.noteTemplates.newName'), body: '# {{titolo}}\n\n' });
      await load(r.item.id);
    });
  const remove = () =>
    current &&
    void save.run(async () => {
      await rl.invoke('templates:remove', { id: current.id });
      await load(current.id === 'letteratura' ? 'letteratura' : '');
    });

  return (
    <Group title={t('settings.noteTemplates.title')} testId="note-templates" sid="noteTemplatesGroup">
      <Row sid="noteTemplates" label={t('settings.noteTemplates.label')} help={t('settings.noteTemplates.hint')} save={save}>
        <div className="note-templates">
          <div className="note-templates__bar">
            <select
              value={id}
              aria-label={t('settings.noteTemplates.label')}
              data-testid="template-select"
              onChange={(e) => {
                const next = items.find((x) => x.id === e.target.value);
                if (next) (setId(next.id), setName(next.name), setBody(next.body));
              }}
            >
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={add} data-testid="template-new">
              {t('settings.noteTemplates.add')}
            </button>
            {current && !current.builtin && (
              <button type="button" onClick={remove} data-testid="template-remove">
                {current.id === 'letteratura' ? t('settings.noteTemplates.restore') : t('settings.noteTemplates.remove')}
              </button>
            )}
          </div>
          <input value={name} maxLength={80} aria-label={t('settings.noteTemplates.name')} data-testid="template-name" onChange={(e) => setName(e.target.value)} onBlur={commit} />
          <textarea value={body} rows={12} maxLength={20000} spellCheck={false} aria-label={t('settings.noteTemplates.body')} data-testid="template-body" onChange={(e) => setBody(e.target.value)} onBlur={commit} />
        </div>
      </Row>
    </Group>
  );
}
