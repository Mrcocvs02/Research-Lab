import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MapView } from '@rl/core';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { Menu } from '../../../components/Menu';
import { Segmented } from '../../../components/Segmented';
import { rl } from '../../../lib/rl';
import { RlError } from '../../../lib/rl-error';
import { safeText } from '../../library/safeText';
import { mapCanvasEl, type ExportCtx, type Notify, type ViewsApi } from '../mapExtras';
import { copyPng, renderPng, renderSvg, type Area } from './render';
import { SvgTooLargeError } from './svgContext';

/** Saved views and the export of the Map (D-527, D-528): one lazy chunk, loaded when the views section opens or an export entry is chosen. */

// ---- Saved views ----
type Project = { id: string; name: string };

function ViewRow({ v, projects, api, onChange, onGone }: { v: MapView; projects: Project[]; api: ViewsApi; onChange(v: MapView): void; onGone(v: MapView): void }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<'rename' | 'project' | null>(null);
  const [text, setText] = useState(v.name);
  const more = useRef<HTMLButtonElement>(null);
  const keep = (patch: Partial<Pick<MapView, 'name' | 'projectId' | 'state'>>, done: string) =>
    rl.invoke('mapViews:save', { view: { id: v.id, name: patch.name ?? v.name, projectId: 'projectId' in patch ? patch.projectId : v.projectId, state: patch.state ?? v.state } }).then(
      (r) => {
        onChange(r.view);
        api.notify.info(done);
      },
      (e: unknown) => api.notify.error(e),
    );
  const remove = () =>
    rl.invoke('mapViews:delete', { id: v.id }).then(
      () => {
        onGone(v);
        // Undo saves the same view again (an unknown id is created again with the same dates).
        api.notify.info(t('mapViews.deleted', { name: safeText(v.name) }), {
          label: t('mapViews.undo'),
          run: () => void rl.invoke('mapViews:save', { view: { id: v.id, name: v.name, projectId: v.projectId, state: v.state, createdAt: v.createdAt } }).then((r) => onChange(r.view), (e: unknown) => api.notify.error(e)),
        });
      },
      (e: unknown) => api.notify.error(e),
    );
  if (edit === 'rename') {
    return (
      <li className="map-view-row">
        <form
          className="map-view-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void keep({ name: text.trim() }, t('mapViews.renamed')).then(() => setEdit(null));
          }}
        >
          <input value={text} maxLength={80} aria-label={t('mapViews.name')} onChange={(e) => setText(e.target.value)} autoFocus data-testid="map-view-rename-input" />
        </form>
      </li>
    );
  }
  if (edit === 'project') {
    return (
      <li className="map-view-row">
        <select
          aria-label={t('mapViews.project')}
          value={v.projectId ?? ''}
          onChange={(e) => void keep({ projectId: e.target.value || null }, t('mapViews.updated', { name: safeText(v.name) })).then(() => setEdit(null))}
          onBlur={() => setEdit(null)}
          autoFocus
          data-testid="map-view-project"
        >
          <option value="">{t('mapViews.noProject')}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {safeText(p.name)}
            </option>
          ))}
        </select>
      </li>
    );
  }
  return (
    <li className="map-view-row">
      <button type="button" className="legend-item map-view-open" title={safeText(v.name)} aria-label={t('mapViews.open', { name: safeText(v.name) })} onClick={() => api.apply(v.state)} data-testid="map-view-item" data-view-id={v.id}>
        <span className="legend-text">{safeText(v.name)}</span>
      </button>
      <button ref={more} type="button" className="icon-button" aria-haspopup="menu" aria-expanded={menu} aria-label={t('mapViews.more', { name: safeText(v.name) })} onClick={() => setMenu(!menu)} data-testid="map-view-more">
        <span aria-hidden="true">⋯</span>
      </button>
      <Menu
        anchor={more}
        open={menu}
        onClose={() => setMenu(false)}
        label={t('mapViews.more', { name: safeText(v.name) })}
        groups={[
          {
            id: 'view',
            items: [
              { id: 'rename', label: t('mapViews.rename'), testId: 'map-view-rename', onSelect: () => (setText(v.name), setEdit('rename')) },
              { id: 'update', label: t('mapViews.update'), testId: 'map-view-update', onSelect: () => void keep({ state: api.capture() }, t('mapViews.updated', { name: safeText(v.name) })) },
              { id: 'link', label: t('mapViews.link'), testId: 'map-view-link', onSelect: () => setEdit('project') },
              { id: 'delete', label: t('mapViews.delete'), testId: 'map-view-delete', danger: true, onSelect: () => void remove() },
            ],
          },
        ]}
      />
    </li>
  );
}

/** The list of saved views with "Save view…", in the side column or in a dialog. */
export function ViewsSection({ api, focusSave = false }: { api: ViewsApi; focusSave?: boolean }) {
  const { t } = useTranslation();
  const [views, setViews] = useState<MapView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [form, setForm] = useState<{ name: string; projectId: string } | null>(() => (focusSave ? { name: api.defaultName(), projectId: '' } : null));
  useEffect(() => {
    let live = true;
    rl.invoke('mapViews:list', {}).then(
      (r) => live && setViews(r.views),
      () => live && setFailed(true),
    );
    rl.invoke('projects:list', {}).then(
      (r) => live && setProjects(r.items.map((p) => ({ id: p.id, name: p.name }))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const tooBig = api.selectionTooBig();
  const save = () => {
    if (!form || !form.name.trim()) return;
    rl.invoke('mapViews:save', { view: { name: form.name.trim().slice(0, 80), projectId: form.projectId || null, state: api.capture() } }).then(
      (r) => {
        setViews((cur) => [...(cur ?? []), r.view]);
        setForm(null);
        api.notify.info(t('mapViews.saved', { name: safeText(r.view.name) }));
      },
      (e: unknown) => (RlError.from(e).details?.reason === 'limit' ? api.notify.fail(t('mapViews.limit')) : api.notify.error(e)),
    );
  };
  return (
    <div className="map-views-body">
      {failed ? (
        <p className="hint" role="alert" data-testid="map-views-error">
          {t('mapViews.loadError')}
        </p>
      ) : views === null ? null : views.length === 0 ? (
        <p className="hint" data-testid="map-views-empty">
          {t('mapViews.empty')}
        </p>
      ) : (
        <ul className="map-views-list" data-testid="map-views-list">
          {views.map((v) => (
            <ViewRow key={v.id} v={v} projects={projects} api={api} onChange={(n) => setViews((cur) => (cur ?? []).map((x) => (x.id === n.id ? n : x)).concat((cur ?? []).some((x) => x.id === n.id) ? [] : [n]))} onGone={(g) => setViews((cur) => (cur ?? []).filter((x) => x.id !== g.id))} />
          ))}
        </ul>
      )}
      {form ? (
        <form
          className="map-view-form"
          data-testid="map-view-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="net-field">
            <span>{t('mapViews.name')}</span>
            <input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus data-testid="map-view-name" />
          </label>
          <label className="net-field">
            <span>{t('mapViews.project')}</span>
            <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} data-testid="map-view-project-pick">
              <option value="">{t('mapViews.noProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {safeText(p.name)}
                </option>
              ))}
            </select>
          </label>
          {tooBig && (
            <p className="hint" data-testid="map-view-toobig">
              {t('mapViews.tooBig')}
            </p>
          )}
          <div className="map-view-actions">
            <Button type="submit" variant="primary" size="sm" disabled={!form.name.trim()} data-testid="map-view-save-go">
              {t('mapViews.saveGo')}
            </Button>
            <Button size="sm" onClick={() => setForm(null)}>
              {t('mapViews.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" onClick={() => setForm({ name: api.defaultName(), projectId: '' })} data-testid="map-view-save">
          {t('mapViews.save')}
        </Button>
      )}
    </div>
  );
}

/** "Saved views ▸" below 1440 px and Ctrl+Shift+S: the same section in a dialog, with the save form open. */
export function ViewsDialog({ api, onClose }: { api: ViewsApi; onClose(): void }) {
  const { t } = useTranslation();
  return (
    <Dialog title={t('mapViews.title')} onClose={onClose} testId="map-views-dialog">
      <div className="dlg-scroll">
        <ViewsSection api={{ ...api, apply: (v) => (onClose(), api.apply(v)) }} focusSave />
      </div>
    </Dialog>
  );
}

// ---- Export ----
const slug = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'map';

/** The small dialog of the export: the area, then the folder (`dialog:chooseFolder`) and the file (`bib:saveText`, never over an existing one). */
export function ExportDialog({ format, ctx, notify, onClose }: { format: 'png' | 'svg'; ctx: ExportCtx; notify: Notify; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const [area, setArea] = useState<Area>('view');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const blocks = ctx.bv !== null;
  const go = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const el = mapCanvasEl();
      const box = el?.getBoundingClientRect();
      const live = box ? { w: box.width, h: box.height } : null;
      // The picture first: an SVG that is too large stops here, before any folder is asked for or file written.
      let text: string;
      let scaled: number | null = null;
      if (format === 'svg') text = await renderSvg(ctx, area, live, el);
      else if (blocks) {
        const r = await renderPng(ctx, area, live, el);
        text = r.base64;
        if (r.scale < 1.99) scaled = Math.round((r.scale / 2) * 100);
      } else if (el) text = (await copyPng(el)).base64;
      else throw new Error('No canvas');
      const picked = await rl.invoke('dialog:chooseFolder', { purpose: 'export-destination', title: t('mapExport.dest') });
      if (!picked) return;
      const date = new Date().toISOString().slice(0, 10);
      const r = await rl.invoke('bib:saveText', { destination: picked.path, fileName: t('mapExport.fileName', { family: slug(ctx.familyName), date }), ext: format, text, ...(format === 'png' ? { base64: true } : {}) });
      notify.info(t('mapExport.done', { file: r.file }));
      if (scaled !== null) notify.info(t('mapExport.scaled', { pct: scaled }));
      onClose();
    } catch (e) {
      if (e instanceof SvgTooLargeError) setMessage(t('mapExport.tooLarge'));
      else {
        setMessage(t('mapExport.failed'));
        notify.error(e);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t('mapExport.title', { format: format.toUpperCase() })} onClose={onClose} testId="map-export-dialog">
      <div className="map-export-body" lang={i18n.language}>
        <div className="net-field">
          <span>{t('mapExport.area')}</span>
          <Segmented<Area>
            size="sm"
            label={t('mapExport.area')}
            value={area}
            onChange={setArea}
            options={[
              { value: 'view', label: t('mapExport.areaView'), testId: 'map-export-area-view' },
              { value: 'all', label: t('mapExport.areaAll'), testId: 'map-export-area-all', disabled: !blocks, disabledReason: t('mapExport.areaOff') },
            ]}
          />
          <span className="visually-hidden" data-testid="map-export-area" data-value={area} />
        </div>
        <p className="hint">{t('mapExport.note')}</p>
        {message && (
          <p className="field-error" role="alert" data-testid="map-export-error">
            {message}
          </p>
        )}
        <div className="map-export-actions">
          <Button onClick={onClose} data-testid="map-export-cancel">
            {t('mapViews.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void go()} data-testid="map-export-go">
            {busy ? t('mapExport.working') : t('mapExport.go')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
