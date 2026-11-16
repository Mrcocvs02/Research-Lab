/**
 * What `documents:open` may hand to the system. An allow list first (the library's scan extensions intersected with
 * a fixed list of formats that are safe to open), then a deny list as a second defence: even a listed format is
 * refused when any dot-separated part of the name is a runnable or macro-enabled type (`a.pdf.exe`).
 */

/** Formats that only display content (no code runs when the default application opens them). */
export const SAFE_OPEN_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf', 'md', 'txt', 'tex', 'rst', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'ipynb', 'csv', 'tsv',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'svg', 'epub',
]);

const DENIED = [
  'exe', 'com', 'bat', 'cmd', 'msi', 'msc', 'application', 'appref-ms', 'settingcontent-ms', 'library-ms', 'scf', 'gadget', 'msp', 'mst',
  'ps1', 'ps1xml', 'ps2', 'ps2xml', 'psc1', 'psc2', 'psm1', 'vb', 'vbe', 'vbs', 'ws', 'wsf', 'wsh', 'sct', 'inf', 'chm', 'xll', 'wll',
  'search-ms', 'diagcab', 'iso', 'vhd', 'vhdx', 'img', 'py', 'pyw', 'pl', 'rb', 'jar', 'jnlp', 'appx', 'msix', 'hta', 'cpl', 'scr', 'pif',
  'lnk', 'url', 'reg', 'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm', 'js', 'jse', 'sh', 'app', 'command', 'appimage', 'dll', 'html', 'htm', 'xhtml',
];
const DENIED_SET = new Set(DENIED);

const BS = String.fromCharCode(92);
const SEP = new RegExp('[' + BS + BS + '/]');

function pathExtList(): string[] {
  return (process.env['PATHEXT'] ?? '')
    .split(';')
    .map((x) => x.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
}

const isDenied = (part: string, pathext: readonly string[]) => DENIED_SET.has(part) || part.startsWith('msh') || pathext.includes(part);

/** Parts after the first dot of a file name, lower case, trailing dots and spaces dropped (Windows ignores them). */
function extensionParts(name: string): string[] {
  const clean = name.replace(/[. ]+$/, '').toLowerCase();
  return clean.split('.').slice(1);
}

/**
 * `relativeName`: the path as recorded (checked for tricks Windows resolves silently); `realPath`: the path after
 * resolving links (what would actually be opened).
 */
export function openVerdict(relativeName: string, realPath: string, scanExtensions: readonly string[]): 'ok' | 'denied' {
  const pathext = pathExtList();
  for (const p of [relativeName, realPath]) {
    const base = p.split(SEP).pop() ?? '';
    // A stream (`a.pdf:x.exe`), a trailing dot or space: not a plain file name.
    if (base.includes(':') || /[. ]$/.test(base)) return 'denied';
    for (const part of extensionParts(base)) if (isDenied(part, pathext)) return 'denied';
  }
  if (SEP.test(relativeName.charAt(0)) || relativeName.split(SEP).some((seg) => seg === '..' || /^[A-Za-z]:/.test(seg))) return 'denied';
  const real = (realPath.split(SEP).pop() ?? '').toLowerCase();
  const ext = real.includes('.') ? (real.split('.').pop() as string) : '';
  const configured = new Set(scanExtensions.map((x) => x.toLowerCase().replace(/^\./, '')));
  return ext !== '' && SAFE_OPEN_EXTENSIONS.has(ext) && configured.has(ext) ? 'ok' : 'denied';
}
