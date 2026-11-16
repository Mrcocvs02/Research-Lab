import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const documentsHandlers = (s: MainServices): Pick<DomainHandlers<'documents'>, 'documents:list' | 'documents:get'> => ({
  'documents:list': async ({ filters, sort, limit, offset }) => (await s.runtime.require()).list({ filters, sort, limit, offset }),
  'documents:get': async ({ docId }) => {
    // `legacy` holds verbatim leftovers of the old index (it can carry absolute paths): it never reaches the renderer.
    const { legacy: _legacy, ...view } = await (await s.runtime.require()).getDocument(docId);
    return view;
  },
});
