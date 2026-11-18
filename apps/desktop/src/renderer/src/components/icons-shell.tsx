/*
 * Shell icons: the 13 shown on the first screen (docs/design/ARCHITETTURA-UI.md 5.4). Inline SVG, no package.
 * Drawings derived from Lucide (https://lucide.dev, ISC licence: Copyright (c) for Lucide Contributors; Feather portions MIT, Cole Bemis).
 * The other 27 icons live in icons.tsx and load with the views.
 */
import type { ReactNode, SVGProps } from 'react';

export type IconSize = 16 | 20 | 24;
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'width' | 'height'> {
  /** 16 inline and in `sm` buttons, 20 bars and sidebar (default), 24 empty states. */
  size?: IconSize;
}

/** Builds an icon component: 24 grid, 1.75 stroke, `currentColor`, decorative unless the caller passes an aria-label. */
export function makeIcon(paths: ReactNode, name: string) {
  const Icon = ({ size = 20, ...rest }: IconProps) => (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest['aria-label'] ? undefined : true}
      focusable="false"
      {...rest}
    >
      {paths}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

export const IconLibrary = makeIcon(
  <>
    <path d="m16 6 4 14" />
    <path d="M12 6v14" />
    <path d="M8 8v12" />
    <path d="M4 4v16" />
  </>,
  'IconLibrary',
);
/** Tray with a down arrow (Da rivedere / Review). */
export const IconReview = makeIcon(
  <>
    <path d="M12 3v8" />
    <path d="m8.5 8 3.5 3.5L15.5 8" />
    <path d="M3 14h5l1.5 2.5h5L16 14h5" />
    <path d="M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
  </>,
  'IconReview',
);
export const IconProject = makeIcon(
  <>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <path d="M8 10v4" />
    <path d="M12 10v2" />
    <path d="M16 10v6" />
  </>,
  'IconProject',
);
/** Compass. */
export const IconDiscover = makeIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </>,
  'IconDiscover',
);
export const IconMap = makeIcon(
  <>
    <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
    <path d="M15 5.764v15" />
    <path d="M9 3.236v15" />
  </>,
  'IconMap',
);
/** Four-point spark: Claude. */
export const IconClaude = makeIcon(<path d="M12 3c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7z" />, 'IconClaude');
export const IconHelp = makeIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </>,
  'IconHelp',
);
export const IconSettings = makeIcon(
  <>
    <path d="M21 4h-7" />
    <path d="M10 4H3" />
    <path d="M21 12h-9" />
    <path d="M8 12H3" />
    <path d="M21 20h-5" />
    <path d="M12 20H3" />
    <path d="M14 2v4" />
    <path d="M8 10v4" />
    <path d="M16 18v4" />
  </>,
  'IconSettings',
);
export const IconBack = makeIcon(
  <>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </>,
  'IconBack',
);
export const IconForward = makeIcon(
  <>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </>,
  'IconForward',
);
export const IconSearch = makeIcon(
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>,
  'IconSearch',
);
export const IconCommand = makeIcon(<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />, 'IconCommand');
/** Ring (Attivita / Activity). */
export const IconActivity = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 9 9" />
  </>,
  'IconActivity',
);
