import type { Page } from '@playwright/test';

export interface LeakReport {
  /** Rules found in the pdf.js sheet (the `@layer pdfjs` block); 0 means the sheet is not loaded and the check proves nothing. */
  rules: number;
  /** Rules whose selector does not start with the reader scope. */
  unscoped: string[];
  /** Selectors that match at least one element outside `.reader-scroll`. */
  leaked: Array<{ selector: string; example: string }>;
}

/**
 * The `leakedRules` check of the audit (D-346): every top-level rule of the pdf.js sheet must be scoped to `.reader-scroll`
 * and must match nothing outside it. The sheet is the one that holds the `@layer pdfjs` block; open the reader first, so it is loaded.
 */
export async function leakedRules(page: Page): Promise<LeakReport> {
  return page.evaluate(() => {
    const out: LeakReport = { rules: 0, unscoped: [], leaked: [] };
    const scope = '.reader-scroll';
    const splitSelectors = (list: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && depth === 0) {
          parts.push(list.slice(start, i).trim());
          start = i + 1;
        }
      }
      parts.push(list.slice(start).trim());
      return parts.filter(Boolean);
    };
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          out.rules++;
          for (const sel of splitSelectors(rule.selectorText)) {
            if (!sel.startsWith(scope)) out.unscoped.push(sel);
            let hit: Element | undefined;
            try {
              hit = Array.from(document.querySelectorAll(sel)).find((el) => !el.closest(scope));
            } catch {
              // a selector the engine cannot query (pseudo-elements and the like) matches no element
            }
            if (hit) out.leaked.push({ selector: sel, example: hit.tagName.toLowerCase() + (hit.className && typeof hit.className === 'string' ? `.${hit.className.split(' ')[0]}` : '') });
          }
        } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) if (rule instanceof CSSLayerBlockRule && rule.name === 'pdfjs') visit(rule.cssRules);
    }
    return out;
  });
}
