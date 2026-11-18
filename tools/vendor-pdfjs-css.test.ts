import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate, generateFromInstalled, OUTPUT, SCOPE } from './vendor-pdfjs-css.mjs';

const src = path.resolve(import.meta.dirname, '../apps/desktop/src/renderer/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('vendored pdf.js viewer css', () => {
  it('is the committed file for the installed pdf.js version', () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(generateFromInstalled());
  });

  it('filters, prefixes and keeps only what the reader needs', () => {
    const css = generate(
      `:root { --a: 1px; --b: var(--a); --unused: 2px; color-scheme: light dark; }
       .pdfViewer .page { margin: var(--b); }
       .sidebar { color: red; }
       .dialog, .textLayer span { color: blue; }
       .annotationEditorLayer { color: red; }
       @media print { .sidebar { color: red; } .canvasWrapper { x: y; } }
       @media print { .sidebar { color: red; } }`,
      '0.0.0',
    );
    expect(css).toContain(`${SCOPE} .pdfViewer .page`);
    expect(css).toContain(`${SCOPE} .textLayer span`);
    expect(css).toContain(`${SCOPE} .canvasWrapper`);
    expect(css).toContain('--a: 1px');
    expect(css).toContain('--b: var(--a)');
    expect(css).not.toContain('--unused');
    expect(css).not.toContain('color-scheme');
    expect(css).not.toMatch(/\.sidebar|\.dialog|annotationEditor/);
  });

  it('every selector of the sheet is under the reader scope', () => {
    const css = readFileSync(OUTPUT, 'utf8');
    const heads = [...css.matchAll(/^ {2}([^\s@}/*][^{;]*)\{/gm)].map((m) => m[1]!.trim());
    expect(heads.length).toBeGreaterThan(10);
    for (const h of heads) for (const sel of h.split(/,\n/)) expect(sel.trim().startsWith(SCOPE)).toBe(true);
  });

  it('shares no top-level class with the app but .textLayer and .page (the latter only under the scope)', () => {
    const sheet = readFileSync(OUTPUT, 'utf8');
    const pdfClasses = new Set<string>();
    for (const m of sheet.matchAll(/^ {2}\.reader-scroll ((?:\.[\w-]+)+)/gm)) for (const c of m[1]!.split('.').filter(Boolean)) pdfClasses.add(c);

    const appClasses = new Set<string>();
    for (const f of walk(src)) {
      if (/\.test\.tsx?$/.test(f)) continue;
      const text = readFileSync(f, 'utf8');
      if (f.endsWith('.css') && f !== OUTPUT) {
        for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([A-Za-z_][\w-]*)/g)) appClasses.add(m[1]!);
      } else if (/\.tsx$/.test(f)) {
        for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g)) {
          const raw = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
          for (const tok of raw.match(/['"` ]([A-Za-z_][\w-]*)(?=['"` ]|$)|^[A-Za-z_][\w-]*/g) ?? []) appClasses.add(tok.replace(/['"` ]/g, ''));
        }
      }
    }
    pdfClasses.delete('reader-scroll');
    const shared = [...pdfClasses].filter((c) => appClasses.has(c)).sort();
    // `.textLayer` is pdf.js's own element that the app styles on purpose (under the scope); `page` is only ever used as `.pdfViewer .page`.
    pdfClasses.delete('reader-scroll');
    expect(shared.filter((c) => !['textLayer', 'page', 'pdfViewer'].includes(c))).toEqual([]);
    expect(/^\.page\b/m.test(sheet.replace(/^ {2}\.reader-scroll/gm, ''))).toBe(false);
  });

  it('the app css has no global .page rule', () => {
    const css = readFileSync(path.join(src, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/(^|[,}\s>+~])\.page(?![\w-])/m.test(css.replace(/\.reader-scroll \.pdfViewer \.page/g, ''))).toBe(false);
  });
});
