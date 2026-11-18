import type { ReactNode } from 'react';
import { safeText } from '../views/library/safeText';
import '../styles/markdown.css';

/**
 * A small Markdown renderer for the notes of a project. It builds React elements from a parsed structure and
 * never touches HTML: raw tags in the text are shown as text, images become their alt text, and a link is a real
 * anchor only for http(s) and mailto addresses. Supported: headings, paragraphs, bullet and numbered lists
 * (nested by indentation), block quotes, fenced code, rules, **bold**, *italic*, ~~strike~~, `code`, [links](url).
 */

type Item = { text: string; children: ListBlock | null };
interface ListBlock {
  t: 'ul' | 'ol';
  items: Item[];
}
export type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'quote'; text: string }
  | { t: 'code'; text: string }
  | { t: 'hr' }
  | ListBlock;

const MAX_INLINE = 4000;
const MAX_DEPTH = 4;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!)) body.push(lines[i++]!);
      out.push({ t: 'code', text: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      out.push({ t: 'h', level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push({ t: 'hr' });
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      i--;
      out.push({ t: 'quote', text: body.join(' ') });
      continue;
    }
    if (LIST_RE.test(line)) {
      flush();
      const rows: Array<{ indent: number; ordered: boolean; text: string }> = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]!);
        if (!m) break;
        rows.push({ indent: m[1]!.replaceAll('\t', '    ').length, ordered: /\d/.test(m[2]!), text: m[3]! });
        i++;
      }
      i--;
      out.push(buildList(rows));
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

function buildList(rows: Array<{ indent: number; ordered: boolean; text: string }>): ListBlock {
  const root: ListBlock = { t: rows[0]!.ordered ? 'ol' : 'ul', items: [] };
  const stack: Array<{ indent: number; list: ListBlock }> = [{ indent: rows[0]!.indent, list: root }];
  for (const r of rows) {
    while (stack.length > 1 && r.indent < stack[stack.length - 1]!.indent) stack.pop();
    let top = stack[stack.length - 1]!;
    if (r.indent > top.indent && top.list.items.length > 0 && stack.length < 6) {
      const parent = top.list.items[top.list.items.length - 1]!;
      parent.children = { t: r.ordered ? 'ol' : 'ul', items: [] };
      top = { indent: r.indent, list: parent.children };
      stack.push(top);
    }
    top.list.items.push({ text: r.text, children: null });
  }
  return root;
}

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/**
 * Optional hook of a caller that owns some link targets (the chat turns `lab://` links into chips): it returns the
 * element for a link, or null to let the default rule decide (a safe web link, or plain text).
 */
export type LinkHook = (href: string, label: string, key: string) => ReactNode | null;

interface Pattern {
  re: RegExp;
  render(m: RegExpExecArray, key: string, depth: number, hook?: LinkHook): ReactNode;
}

const PATTERNS: Pattern[] = [
  { re: /`([^`]+)`/, render: (m, key) => <code key={key}>{safeText(m[1]!)}</code> },
  { re: /!\[([^\]]*)\]\(([^)\s]*)\)/, render: (m, key) => <em key={key}>{safeText(m[1]!) || '[image]'}</em> },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    render: (m, key, depth, hook) => {
      const owned = hook?.(m[2]!, m[1]!, key);
      if (owned != null) return owned;
      return SAFE_LINK.test(m[2]!) ? (
        <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer">
          {inline(m[1]!, `${key}l`, depth + 1, hook)}
        </a>
      ) : (
        <span key={key}>{inline(m[1]!, `${key}l`, depth + 1, hook)}</span>
      );
    },
  },
  { re: /\*\*([^*]+?)\*\*|__([^_]+?)__/, render: (m, key, depth, hook) => <strong key={key}>{inline(m[1] ?? m[2]!, `${key}b`, depth + 1, hook)}</strong> },
  { re: /~~([^~]+?)~~/, render: (m, key, depth, hook) => <del key={key}>{inline(m[1]!, `${key}d`, depth + 1, hook)}</del> },
  { re: /\*([^*\s][^*]*?)\*|(?<![\p{L}\p{N}])_([^_\s][^_]*?)_(?![\p{L}\p{N}])/u, render: (m, key, depth, hook) => <em key={key}>{inline(m[1] ?? m[2]!, `${key}e`, depth + 1, hook)}</em> },
];

/** Inline formatting of one paragraph; very long or deeply nested text is shown as plain text. */
export function inline(text: string, keyBase = 'i', depth = 0, hook?: LinkHook): ReactNode[] {
  if (depth > MAX_DEPTH || text.length > MAX_INLINE) return [safeText(text)];
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest.length > 0) {
    let best: { p: Pattern; m: RegExpExecArray } | null = null;
    for (const p of PATTERNS) {
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { p, m };
    }
    if (!best) {
      out.push(safeText(rest));
      break;
    }
    if (best.m.index > 0) out.push(safeText(rest.slice(0, best.m.index)));
    out.push(best.p.render(best.m, `${keyBase}${n++}`, depth, hook));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

function renderList(list: ListBlock, key: string, hook?: LinkHook): ReactNode {
  const Tag = list.t;
  return (
    <Tag key={key}>
      {list.items.map((it, i) => (
        <li key={i}>
          {inline(it.text, `${key}-${i}`, 0, hook)}
          {it.children && renderList(it.children, `${key}-${i}c`, hook)}
        </li>
      ))}
    </Tag>
  );
}

export function renderBlocks(blocks: Block[], hook?: LinkHook): ReactNode[] {
  return blocks.map((b, i) => {
    const key = `b${i}`;
    switch (b.t) {
      case 'h': {
        const Tag = `h${Math.min(6, b.level + 1)}` as 'h2';
        return <Tag key={key}>{inline(b.text, key, 0, hook)}</Tag>;
      }
      case 'p':
        return <p key={key}>{inline(b.text, key, 0, hook)}</p>;
      case 'quote':
        return <blockquote key={key}>{inline(b.text, key, 0, hook)}</blockquote>;
      case 'code':
        return (
          <pre key={key}>
            <code>{safeText(b.text)}</code>
          </pre>
        );
      case 'hr':
        return <hr key={key} />;
      default:
        return renderList(b, key, hook);
    }
  });
}

/** Markdown text as safe React elements. */
export function Markdown({ source, className, linkHook }: { source: string; className?: string; linkHook?: LinkHook }) {
  return (
    <div className={className ? `markdown ${className}` : 'markdown'} data-testid="markdown">
      {renderBlocks(parseBlocks(source), linkHook)}
    </div>
  );
}
