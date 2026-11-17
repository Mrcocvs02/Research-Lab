/** What a followed source is called in lists: its label, else its query, else the label of its kind ("own-preprint" has no query). */
export function sourceName(s: { label: string; query: string }, kindLabel: string): string {
  return s.label.trim() || s.query.trim() || kindLabel;
}
