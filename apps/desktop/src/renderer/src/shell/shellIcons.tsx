import type { SVGProps } from 'react';

/*
 * The drawings of the first screen as data: one component and a table of path strings ("|" separates the paths of an icon), so that
 * each icon costs its drawing and nothing else. Same 24-grid, 1.75 stroke, Lucide-derived paths (ISC licence) as
 * `components/icons-shell.tsx` and `components/icons.tsx`, which the lazy views use.
 */
const PATHS = {
  library: 'm16 6 4 14|M12 6v14|M8 8v12|M4 4v16',
  review: 'M12 3v8|m8.5 8 3.5 3.5L15.5 8|M3 14h5l1.5 2.5h5L16 14h5|M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
  project: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z|M8 10v4|M12 10v2|M16 10v6',
  discover: 'M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0|M16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88z',
  map: 'M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z|M15 5.764v15|M9 3.236v15',
  claude: 'M12 3c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7z',
  help: 'M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0|M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3|M12 17h.01',
  tag: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z|M7.5 7.5h.01',
  settings: 'M21 4h-7|M10 4H3|M21 12h-9|M8 12H3|M21 20h-5|M12 20H3|M14 2v4|M8 10v4|M16 18v4',
  back: 'm12 19-7-7 7-7|M19 12H5',
  forward: 'M5 12h14|m12 5 7 7-7 7',
  search: 'M3 11a8 8 0 1 0 16 0 8 8 0 1 0-16 0|m21 21-4.3-4.3',
  command: 'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3',
  close: 'M18 6 6 18|m6 6 12 12',
  chevron: 'm6 9 6 6 6-6',
  check: 'M20 6 9 17l-5-5',
  alert: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3|M12 9v4|M12 17h.01',
  undo: 'M3 7v6h6|M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13',
  redo: 'M21 7v6h-6|M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7',
  history: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8|M3 3v5h5|M12 7v5l4 2',
  sidebar: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z|M9 3v18',
} as const;

export type ShellIconName = keyof typeof PATHS;

/** Decorative icon of the shell: 20 px by default (16 inline, 24 in empty states), `currentColor`, 1.75 stroke. */
export function Icon({ name, size = 20, ...rest }: { name: ShellIconName; size?: 16 | 20 | 24 } & Omit<SVGProps<SVGSVGElement>, 'children' | 'width' | 'height'>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {PATHS[name].split('|').map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
