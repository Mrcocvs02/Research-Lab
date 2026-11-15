import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

export const documentsHandlers = (s: MainServices): DomainHandlers<'documents'> => ({
  'documents:list': async ({ filters, sort, limit, offset }) => (await s.runtime.require()).list({ filters, sort, limit, offset }),
  'documents:get': async ({ docId }) => (await s.runtime.require()).getDocument(docId),
});
