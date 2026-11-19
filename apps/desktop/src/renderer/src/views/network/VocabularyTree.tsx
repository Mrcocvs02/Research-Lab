import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { ErrorNote } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { setLibraryIntent } from '../../lib/libraryIntent';
import { useNav } from '../../lib/nav';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { familyLabel, TOPIC_FAMILY, useFamilies } from './grouping';
import { MapIllustration } from './NetChrome';
import { buildVocabTree, layoutVocab, type VocabSource } from './vocabTree';

const ROW = 22;
const COL = 210;
const PAD = 12;
const MAX_LABEL = 30;
/** The "other" cluster of a family: not a value of the vocabulary. */
const OTHER = 'other';

interface Link {
  a: string;
  b: string;
  lift: number;
  shared: number;
}
const cut = (s: string): string => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);
const radius = (n: number, max: number): number => 3 + 5 * Math.sqrt(n / Math.max(max, 1));

interface Props {
  /** "Show on the Map": the Map grouped by this family. */
  onShowInMap(family: string): void;
}

/**
 * The vocabulary as a tree (section 19.2.7): the values of a family (Topic by default) and their sub-topics from left to right, a row of
 * 22 px per leaf so no label ever collides, the size of a node from the papers under it. A click on a sub-topic opens its third level;
 * the cross links (nodes that go together) show only while the pointer is on one of their ends. Never the keywords, never the loose tags.
 */
export function VocabularyTree({ onShowInMap }: Props) {
  const { t } = useTranslation();
  const nav = useNav();
  const [family, setFamily] = useState(TOPIC_FAMILY);
  const offered = useFamilies(undefined, true);
  const families = offered.filter((f) => f.id !== 'auto' && !f.id.startsWith('prefix:'));
  const [nodes, setNodes] = useState<VocabSource[] | null>(null);
  const [kinds, setKinds] = useState<Map<string, string | undefined>>(new Map());
  const [roots, setRoots] = useState<Array<{ id: string; label: string }> | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    rl.invoke('taxonomy:get', {}).then(
      (r) => {
        if (!live) return;
        setNodes(r.nodes.filter((n) => n.status !== 'deprecated').map((n) => ({ id: n.id, label: n.label, parents: n.parents, subtree: n.counts.subtree })));
        setKinds(new Map(r.nodes.map((n) => [n.id, n.family])));
      },
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setRoots(null);
    setOpened(new Set());
    setPicked(null);
    rl.invoke('graph:family', { family }).then(
      (r) => live && setRoots((r.areas ?? []).filter((a) => a.id !== OTHER).map((a) => ({ id: a.id, label: a.label }))),
      (e: unknown) => live && setError(e),
    );
    rl.invoke('graph:vocabLinks', { family }).then(
      (r) => live && setLinks(r.links),
      () => live && setLinks([]),
    );
    return () => {
      live = false;
    };
  }, [family]);

  const tree = useMemo(() => (nodes && roots ? buildVocabTree(roots.filter((r) => kinds.get(r.id) !== 'keywords' && nodes.some((n) => n.id === r.id)), nodes, opened) : []), [nodes, roots, kinds, opened]);
  const { placed, rows } = useMemo(() => layoutVocab(tree), [tree]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);
  const max = Math.max(1, ...placed.map((p) => p.node.count));
  const cols = Math.max(1, ...placed.map((p) => p.col + 1));
  const x = (col: number): number => PAD + col * COL;
  const y = (row: number): number => PAD + row * ROW + ROW / 2;
  const shownLinks = hover ? links.filter((l) => (l.a === hover || l.b === hover) && byId.has(l.a) && byId.has(l.b)) : [];
  const sel = picked ? byId.get(picked) : undefined;

  const choose = (id: string, depth: number, hasMore: boolean) => {
    setPicked(id);
    if (depth === 2 && hasMore) setOpened((o) => new Set(o).add(id));
  };
  const showInLibrary = (id: string) => {
    setLibraryIntent({ tags: [id] });
    nav.navigate({ view: 'library' });
  };

  return (
    <div className="vocab" data-testid="vocab-view" data-family={family}>
      <div className="vocab-bar">
        <label className="net-field">
          <span>{t('vicinity.vocab.family')}</span>
          <select value={family} onChange={(e) => setFamily(e.target.value)} data-testid="vocab-family">
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {familyLabel(t, f)}
              </option>
            ))}
          </select>
        </label>
        {sel && (
          <span className="vocab-actions" data-testid="vocab-actions">
            <strong>{safeText(sel.node.label)}</strong>
            <button type="button" onClick={() => onShowInMap(family)} data-testid="vocab-show-map">
              {t('vicinity.vocab.showMap')}
            </button>
            <button type="button" onClick={() => showInLibrary(sel.node.id)} data-testid="vocab-show-library">
              {t('vicinity.vocab.showLibrary')}
            </button>
          </span>
        )}
      </div>
      {error ? <ErrorNote testId="vocab-error">{errorMessage(error, t)}</ErrorNote> : null}
      {nodes && roots && tree.length === 0 && !error && (
        <EmptyState icon={<MapIllustration />} title={t('vicinity.vocab.emptyTitle')}>
          {t('vicinity.vocab.emptyText')}
        </EmptyState>
      )}
      {tree.length > 0 && (
        <div className="vocab-scroll">
          <svg width={PAD * 2 + cols * COL} height={PAD * 2 + rows * ROW} role="tree" aria-label={t('vicinity.vocab.label')}>
            {placed.map((p) =>
              p.parent ? (
                <path key={`e-${p.node.id}`} className="vocab-edge" d={`M${x(p.parent.col)},${y(p.parent.row)} C${x(p.parent.col) + 70},${y(p.parent.row)} ${x(p.col) - 70},${y(p.row)} ${x(p.col)},${y(p.row)}`} />
              ) : null,
            )}
            {shownLinks.map((l) => {
              const a = byId.get(l.a)!;
              const b = byId.get(l.b)!;
              const bend = Math.abs(x(a.col) - x(b.col)) + 40;
              return <path key={`${l.a}|${l.b}`} className="vocab-cross" data-testid="vocab-cross" d={`M${x(a.col)},${y(a.row)} C${x(a.col) - bend},${y(a.row)} ${x(b.col) - bend},${y(b.row)} ${x(b.col)},${y(b.row)}`} />;
            })}
            {placed.map((p) => {
              const r = radius(p.node.count, max);
              const go = () => choose(p.node.id, p.node.depth, p.node.more > 0);
              return (
                <g key={p.node.id}>
                  <g
                    className={p.node.id === picked ? 'vocab-node on' : 'vocab-node'}
                    role="treeitem"
                    aria-level={p.node.depth}
                    aria-selected={p.node.id === picked}
                    tabIndex={0}
                    transform={`translate(${x(p.col)},${y(p.row)})`}
                    onClick={go}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        go();
                      }
                    }}
                    onMouseEnter={() => setHover(p.node.id)}
                    onMouseLeave={() => setHover((h) => (h === p.node.id ? null : h))}
                    onFocus={() => setHover(p.node.id)}
                    onBlur={() => setHover((h) => (h === p.node.id ? null : h))}
                    data-testid="vocab-node"
                    data-id={p.node.id}
                    data-depth={p.node.depth}
                    data-count={p.node.count}
                  >
                    <circle r={r} />
                    <text x={r + 6} y={4}>
                      {safeText(cut(p.node.label))} <tspan className="vocab-n">{p.node.count}</tspan>
                    </text>
                  </g>
                  {p.moreRow !== undefined && (
                    <text className="vocab-more" x={x(p.col + 1)} y={y(p.moreRow) + 4} data-testid="vocab-more">
                      {`+${p.node.more}`}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
