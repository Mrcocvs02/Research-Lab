/** Resources (48), import from DOI, arXiv or URL (23) and Resume (25). Thin: the code is in `features/`, loaded on first use (D-408). */
import { addToInbox } from '../../inbox/service.js';
import { getResume, recordResume } from '../../study/resume.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const resources = () => import('../../features/resources/service.js');
const importing = () => import('../../features/importId/service.js');

export const resourcesHandlers = (s: MainServices): DomainHandlers<'resources'> => ({
  'resources:list': async (r) => (await resources()).listResources(s, r),
  'resources:add': async (r) => (await resources()).addResource(s, r),
  'resources:update': async (r) => (await resources()).updateResource(s, r),
  'resources:remove': async ({ id }) => (await resources()).removeResource(s, id),
  'resources:open': async ({ id }) => (await resources()).openResource(s, id),
  'resources:preview': async ({ id }) => (await resources()).previewResource(s, id),
});

export const importIdHandlers = (s: MainServices): DomainHandlers<'importId'> => ({
  'importId:resolve': async (r) => (await importing()).resolve(s, r),
  'importId:add': async (r) => (await importing()).add(s, r, (paths) => addToInbox(s, paths)),
});

export const resumeHandlers = (s: MainServices): DomainHandlers<'resume'> => ({
  'resume:get': () => getResume(s),
  'resume:record': (r) => recordResume(s, r),
});
