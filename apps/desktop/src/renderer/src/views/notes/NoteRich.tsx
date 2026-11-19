import { createElement, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiUi } from '../../lib/aiUi';
import { findMath, latexToMathML, type MNode } from '../../lib/mathml';
import { Markdown } from '../../lib/markdown';
import { useReader } from '../../lib/reader';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import './notes.css';

/**
 * The rich side of the notes editor, one lazy chunk (D-426): the preview with LaTeX formulas (own converter, no dependency)
 * and `[[` links shown with the CURRENT title of their target, the `[[` completion list, and the template menu. Nothing here
 * runs until a note is previewed, a `[[` is typed or an empty note is opened.
 */

const style = (css: string): CSSProperties => Object.fromEntries(css.split(';').filter(Boolean).map((d) => d.split(':').map((x) => x.trim())).map(([k, v]) => [k!.replace(/-(\w)/g, (_m, c: string) => c.toUpperCase()), v!]));

/** MathML elements from the tree (never from a string). */
function build(n: MNode, key: number): ReactNode {
  const { style: css, ...attrs } = n.a ?? {};
  const props: Record<string, unknown> = { ...attrs, key, ...(css ? { style: style(css) } : {}) };
  return createElement(n.t, props, ...(typeof n.c === 'string' ? [n.c] : (n.c ?? []).map(build)));
}

function Formula({ tex, display }: { tex: string; display: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const tree = useMemo(() => latexToMathML(tex, display), [tex, display]);
  const copy = () => {
    void navigator.clipboard?.writeText(tex).then(() => setCopied(true), () => {});
    setTimeout(() => setCopied(false), 1500);
  };
  if (!tree)
    return (
      <span className="math-raw" title={t('notes.math.unrendered')} data-testid="math-raw">
        {safeText(display ? `$$${tex}$$` : `$${tex}$`)}
      </span>
    );
  return (
    <span className={display ? 'math math--display' : 'math'} data-testid="math">
      {build(tree, 0)}
      <button type="button" className="math__copy" onClick={copy} aria-label={t('notes.math.copy')} title={t('notes.math.copy')} data-testid="math-copy">
        {copied ? '✓' : 'TeX'}
      </button>
    </span>
  );
}

const WIKI = /\[\[([^\]|\n]{1,300})\|(lab:\/\/(?:doc|project)\/[A-Za-z0-9._-]{1,128}(?:\?page=[1-9][0-9]{0,5})?)\]\]/g;
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/;
const TARGET = /^lab:\/\/(doc|project)\/([A-Za-z0-9._-]+)(?:\?page=(\d+))?$/;

interface Prepared {
  text: string;
  maths: Array<{ tex: string; display: boolean }>;
  docIds: string[];
  projectIds: string[];
}

/** The note with formulas and `[[` links swapped for Markdown links the hook below turns into elements; code stays as written. */
export function prepare(src: string): Prepared {
  const maths: Prepared['maths'] = [];
  const docIds = new Set<string>();
  const projectIds = new Set<string>();
  const text = src
    .split(CODE)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      let out = '';
      let last = 0;
      for (const [a, b, tex, display] of findMath(part)) {
        const gap = display ? '\n\n' : '';
        out += `${part.slice(last, a)}${gap}[x](math:${maths.push({ tex, display }) - 1})${gap}`;
        last = b;
      }
      out += part.slice(last);
      return out.replace(WIKI, (_m, title: string, target: string) => {
        const m = TARGET.exec(target);
        if (m && m[1] === 'doc' && /^[0-9a-f]{16}$/.test(m[2]!)) docIds.add(m[2]!);
        else if (m && m[1] === 'project') projectIds.add(m[2]!);
        return `[${title.replace(/[[\]]/g, ' ')}](${target})`;
      });
    })
    .join('');
  return { text, maths, docIds: [...docIds], projectIds: [...projectIds] };
}

function NoteLink({ href, label, title }: { href: string; label: string; title: string | null | undefined }) {
  const { t } = useTranslation();
  const { openReader } = useReader();
  const { openProject } = useAiUi();
  const m = TARGET.exec(href);
  if (!m) return <span>{safeText(label)}</span>;
  const [, kind, id, page] = m;
  // `title === null`: the target is gone; its saved title stays, marked.
  const gone = title === null;
  return (
    <button
      type="button"
      className={gone ? 'note-link note-link--gone' : 'note-link'}
      title={gone ? t('notes.links.gone') : t('notes.links.open')}
      data-testid="note-link"
      data-kind={kind}
      onClick={() => (kind === 'doc' ? openReader(id!, page ? Number(page) : undefined) : openProject(id!))}
    >
      {safeText(title ?? label)}
    </button>
  );
}

/** The Markdown preview of a note: formulas as MathML, one that is not understood as written with a discreet mark, `[[` links by identifier. */
export function NotePreview({ source }: { source: string }) {
  const prep = useMemo(() => prepare(source), [source]);
  const [titles, setTitles] = useState<{ docs: Record<string, string>; projects: Record<string, string> } | null>(null);
  const key = `${prep.docIds.join()}|${prep.projectIds.join()}`;
  useEffect(() => {
    if (prep.docIds.length === 0 && prep.projectIds.length === 0) return setTitles(null);
    let alive = true;
    rl.invoke('links:titles', { docIds: prep.docIds.slice(0, 100), projectIds: prep.projectIds.slice(0, 100) }).then((r) => alive && setTitles(r), () => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const hook = (href: string, label: string, k: string): ReactNode => {
    if (href.startsWith('math:')) {
      const f = prep.maths[Number(href.slice(5))];
      return f ? <Formula key={k} tex={f.tex} display={f.display} /> : null;
    }
    const m = TARGET.exec(href);
    if (!m) return null;
    const title = titles === null ? undefined : ((m[1] === 'doc' ? titles.docs : titles.projects)[m[2]!] ?? null);
    return <NoteLink key={k} href={href} label={label} title={title} />;
  };
  return <Markdown source={prep.text} linkHook={hook} />;
}

interface Suggest {
  kind: 'doc' | 'project';
  id: string;
  title: string;
}

/**
 * The list under the note box while a `[[` is open: documents and projects that match what was typed. Arrow keys, Enter or Tab
 * and Escape are read from the box itself, so the typing never leaves it. The pick is the link by identifier.
 */
export function LinkPicker({ query, input, onPick, onClose }: { query: string; input: HTMLTextAreaElement | null; onPick(markdown: string): void; onClose(): void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Suggest[]>([]);
  const [at, setAt] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      rl.invoke('links:suggest', { query }).then(
        (r) => {
          if (!alive) return;
          setItems(r.items);
          setAt(0);
          setDone(true);
        },
        () => alive && setDone(true),
      );
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);
  const pick = (s: Suggest) => onPick(`[[${s.title.replace(/[[\]|\n]/g, ' ').trim()}|lab://${s.kind}/${s.id}]]`);
  const live = useRef({ items, at, pick, onClose });
  live.current = { items, at, pick, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { items: list, at: cur, pick: choose, onClose: close } = live.current;
      if (e.key === 'Escape') close();
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list.length > 0) setAt((cur + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
      else if ((e.key === 'Enter' || e.key === 'Tab') && list[cur]) choose(list[cur]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    input?.addEventListener('keydown', onKey, true);
    return () => input?.removeEventListener('keydown', onKey, true);
  }, [input]);
  return (
    <ul className="link-picker" role="listbox" aria-label={t('notes.links.picker')} data-testid="link-picker">
      {items.map((s, i) => (
        <li key={`${s.kind}:${s.id}`} role="option" aria-selected={i === at}>
          <button type="button" className={i === at ? 'is-on' : undefined} onMouseDown={(e) => (e.preventDefault(), pick(s))} data-testid="link-option" data-kind={s.kind}>
            <span className="link-picker__kind">{t(`notes.links.kind_${s.kind}`)}</span> {safeText(s.title)}
          </button>
        </li>
      ))}
      {done && items.length === 0 && <li className="hint">{t('notes.links.none')}</li>}
    </ul>
  );
}

/** "Use a template…" for an empty note; shown only when there is more than one template (the built-in one alone is not offered). */
export function TemplateMenu({ docId, onApply }: { docId: string; onApply(text: string): void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let alive = true;
    rl.invoke('templates:list', {}).then((r) => alive && setItems(r.items), () => {});
    return () => {
      alive = false;
    };
  }, []);
  if (items.length < 2) return null;
  return (
    <select
      value=""
      aria-label={t('notes.templates.use')}
      data-testid="note-template"
      onChange={(e) => {
        const id = e.target.value;
        if (id) void rl.invoke('templates:apply', { id, docId }).then((r) => onApply(r.text), () => {});
      }}
    >
      <option value="">{t('notes.templates.use')}</option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {safeText(i.name)}
        </option>
      ))}
    </select>
  );
}
