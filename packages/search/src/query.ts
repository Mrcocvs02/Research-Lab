/**
 * User text to an FTS5 MATCH expression. The expression is built ONLY from tokens made of letters and
 * digits, each wrapped in double quotes, so no input can produce an FTS5 syntax error (operators,
 * parentheses, `NEAR`, column names, stray quotes are all neutralised).
 */

export interface TextFilters {
  authors: string[];
  tags: string[];
  types: string[];
  venues: string[];
  yearFrom?: number;
  yearTo?: number;
}

export interface ParsedQuery {
  /** FTS5 MATCH expression, or null when there is nothing to match against the text. */
  match: string | null;
  /** The text had something other than filters and whitespace. */
  hasText: boolean;
  filters: TextFilters;
}

export const MAX_QUERY_CHARS = 500;
const MAX_TERMS = 32;

/** Folds case and diacritics (same folding as the FTS tokenizer, `remove_diacritics 2`). */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

const CONTROL_RE = /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g;
/** Removes control characters (the match markers among them) from a text before it is indexed. */
export function stripControl(s: string): string {
  return s.replace(CONTROL_RE, ' ');
}

const TOKEN_RE = /[\p{L}\p{N}\p{M}]+/gu;
export function wordTokens(s: string): string[] {
  return s.match(TOKEN_RE) ?? [];
}

const FILTER_NAMES: Record<string, 'authors' | 'tags' | 'types' | 'venues' | 'year'> = {
  author: 'authors',
  autore: 'authors',
  tag: 'tags',
  etichetta: 'tags',
  type: 'types',
  tipo: 'types',
  venue: 'venues',
  rivista: 'venues',
  year: 'year',
  anno: 'year',
};

function parseYear(value: string, into: TextFilters): void {
  const v = value.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})$/.exec(v))) {
    into.yearFrom = Number(m[1]);
    into.yearTo = Number(m[1]);
  } else if ((m = /^(\d{4})\s*(?:-|\.\.)\s*(\d{4})$/.exec(v))) {
    into.yearFrom = Math.min(Number(m[1]), Number(m[2]));
    into.yearTo = Math.max(Number(m[1]), Number(m[2]));
  } else if ((m = /^>=?\s*(\d{4})$/.exec(v))) {
    into.yearFrom = Number(m[1]) + (v.startsWith('>=') ? 0 : 1);
  } else if ((m = /^<=?\s*(\d{4})$/.exec(v))) {
    into.yearTo = Number(m[1]) - (v.startsWith('<=') ? 0 : 1);
  }
}

type Item = { kind: 'term'; expr: string } | { kind: 'or' };

export function parseQuery(input: string): ParsedQuery {
  const text = input.slice(0, MAX_QUERY_CHARS);
  const filters: TextFilters = { authors: [], tags: [], types: [], venues: [] };
  const items: Item[] = [];
  let hasText = false;
  let i = 0;
  const n = text.length;
  const isSpace = (c: string) => /\s/u.test(c);

  const readQuoted = (): string => {
    // text[i] is the opening quote
    const end = text.indexOf('"', i + 1);
    const value = end === -1 ? text.slice(i + 1) : text.slice(i + 1, end);
    i = end === -1 ? n : end + 1;
    return value;
  };
  const addPhrase = (value: string, prefix: boolean) => {
    const tokens = wordTokens(value);
    if (tokens.length === 0) return;
    items.push({ kind: 'term', expr: `"${tokens.join(' ')}"${prefix ? '*' : ''}` });
  };

  while (i < n) {
    const c = text[i]!;
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const value = readQuoted();
      hasText = true;
      const prefix = text[i] === '*';
      while (text[i] === '*') i++;
      addPhrase(value, prefix);
      continue;
    }
    // field:value
    const field = /^([A-Za-z]+):/.exec(text.slice(i, i + 20));
    const fieldKey = field ? FILTER_NAMES[field[1]!.toLowerCase()] : undefined;
    if (field && fieldKey) {
      i += field[0].length;
      let value: string;
      if (text[i] === '"') value = readQuoted();
      else {
        const start = i;
        while (i < n && !isSpace(text[i]!)) i++;
        value = text.slice(start, i);
      }
      if (fieldKey === 'year') parseYear(value, filters);
      else {
        const norm = normalizeText(wordTokens(value).join(' '));
        if (norm) filters[fieldKey].push(norm);
      }
      continue;
    }
    // plain word
    const start = i;
    while (i < n && !isSpace(text[i]!)) i++;
    const word = text.slice(start, i);
    if (word === 'OR') {
      items.push({ kind: 'or' });
      continue;
    }
    hasText = true;
    addPhrase(word, /\*+$/.test(word));
  }

  // Keep an OR only between two terms; cap the number of terms.
  const out: string[] = [];
  let terms = 0;
  for (let k = 0; k < items.length; k++) {
    const it = items[k]!;
    if (it.kind === 'term') {
      if (terms >= MAX_TERMS) break;
      out.push(it.expr);
      terms++;
    } else if (out.length > 0 && out[out.length - 1] !== 'OR' && items[k + 1]?.kind === 'term') {
      out.push('OR');
    }
  }
  return { match: out.length > 0 ? out.join(' ') : null, hasText, filters };
}
