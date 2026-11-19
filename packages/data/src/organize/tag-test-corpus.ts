import type { TaxonomyNode } from '@rl/core';
import { slugify } from '../normalize.js';
import type { CleanupDoc, CleanupInput } from './tag-cleanup.js';

/** A synthetic vocabulary with the shapes of the audit (generic names only), shared by the tests of the tag vocabulary. */
export const node = (label: string, over: Partial<TaxonomyNode> = {}): TaxonomyNode => ({ id: slugify(label), label, parents: [], aliases: [], implies: [], status: 'active', origin: 'user', ...over });
export const idOf = slugify;

/** Ground truth: each group is one concept written in several ways. */
export const TRUTH: string[][] = [
  ['concetto', 'concetti'],
  ['2x', '2-x'],
  ['ABC', 'alfa_beta_gamma', 'ABCs', 'Alfa beta gamma (ABC)'],
  ['gamma model', 'gamma models'],
  ['delta tree', 'delta trees'],
  ['epsilon class', 'epsilon classes'],
  ['zeta study', 'zeta studies'],
  ['kappa_set', 'KappaSet'],
  ['lambda-op', 'lambdaop'],
  ['theta chain', 'ThetaChain'],
  ['omega process', 'omega processes'],
  ['sigma graph', 'Sigma graphs'],
  ['rho flow', 'rhoflow'],
  ['tau field', 'tau fields'],
  ['upsilon base', 'UpsilonBase'],
  ['phi mapping', 'phi mappings'],
  ['chi test', 'chi tests'],
  ['psi layer', 'psi layers'],
  ['colour x', 'color x'],
  ['Delta epsilon zeta', 'DEZ'],
];
/** Tags that look alike but are not the same. */
export const DIFFERENT: string[] = ['3x', 'model a', 'model b', 'alpha 1', 'alpha 2', 'Beta unit', 'Gamma unit'];

export function corpus(): CleanupInput {
  const nodes: TaxonomyNode[] = [];
  const docs: Array<{ id: string; tags: string[] }> = Array.from({ length: 12 }, (_, i) => ({ id: `d${String(i).padStart(2, '0')}`, tags: [] }));
  let cursor = 0;
  const give = (label: string, count: number): void => {
    const id = slugify(label);
    for (let k = 0; k < count; k++) docs[(cursor + k) % docs.length]?.tags.push(id);
    cursor += 1;
  };
  for (const [i, group] of TRUTH.entries()) {
    group.forEach((label, j) => {
      nodes.push(node(label));
      // The variants of a concept are used on different documents, except the last concept pair (they share one: R4/R5 evidence).
      give(label, 1 + ((i + j) % 3));
    });
  }
  for (const label of DIFFERENT) {
    nodes.push(node(label));
    give(label, 2);
  }
  // The two spellings of one concept are used together on a document (evidence for the 'likely' rating).
  for (const l of ['colour x', 'color x']) docs[2]?.tags.push(slugify(l));
  // A block of twins on the same three documents, a parent pair and a pair with an alias collision.
  for (const label of ['twin a', 'twin b', 'twin c', 'twin d', 'twin e']) {
    nodes.push(node(label));
    for (const d of [1, 4, 7]) docs[d]?.tags.push(slugify(label));
  }
  nodes.push(node('Xtopic'), node('Xtopic methods'));
  for (const d of [0, 3, 5, 8]) docs[d]?.tags.push('xtopic-methods');
  for (const d of [0, 3, 5, 8, 9]) docs[d]?.tags.push('xtopic');
  const out: CleanupDoc[] = docs;
  return { nodes, docs: out };
}
