import type { Tool } from './toolMachine';

const svg = (body: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${body}</svg>`)}")`;
const OUTLINE = 'fill="white" stroke="black" stroke-width="1.2"';

/**
 * The mouse cursor of a tool, as a CSS `cursor` value: the shape of the tool and, for the two brushes, a dot in the colour of the
 * stroke (`hex` is read from the colour token, so the drawing follows the theme). Select keeps the normal cursor.
 */
export function cursorFor(tool: Tool, hex: string): string | null {
  const dot = `<circle cx="19" cy="19" r="4" fill="${hex}" stroke="black" stroke-width="1"/>`;
  if (tool === 'highlight') return `${svg(`<path d="M4 20l3-1 11-11-2-2L5 17z" ${OUTLINE}/>${dot}`)} 3 21, text`;
  if (tool === 'underline') return `${svg(`<path d="M5 20h10" stroke="black" stroke-width="2"/><path d="M6 17l3-1 9-9-2-2-9 9z" ${OUTLINE}/>${dot}`)} 3 21, text`;
  if (tool === 'eraser') return `${svg(`<path d="M8 20l-4-4 9-9 6 6-6 7z" ${OUTLINE}/><path d="M9 20h11" stroke="black" stroke-width="1.5"/>`)} 4 20, pointer`;
  return null;
}
