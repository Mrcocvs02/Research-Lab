/** Zotero and BibTeX (7, 52). Thin: the code is in `main/features/bib/`, loaded on first use (D-408). */
import { addToInbox } from '../../inbox/service.js';
import type { DomainHandlers } from '../types.js';
import type { MainServices } from './services.js';

const reading = () => import('../../features/bib/importer.js');
const refs = () => import('../../features/bib/refs.js');
const prisma = () => import('../../features/discover/prisma.js');
const linking = () => import('../../features/bib/link.js');

export const bibHandlers = (s: MainServices): DomainHandlers<'bib'> => ({
  'bib:analyze': async (r) => (await reading()).analyze(s, r),
  'bib:import': async (r) => (await reading()).importRun(s, r, (paths) => addToInbox(s, paths)),
  'bib:link': async (r) => {
    // A project without a link answers here: opening a project loads nothing of the feature.
    if (r.op === 'status' && !(await (await s.runtime.require()).store.projects.get(r.projectId))?.bibLink) return { linked: false, file: null, state: 'ok', at: null };
    return (await linking()).manage(s, r);
  },
  'bib:copy': async (r) => (await linking()).copyBib(s, r),
  'bib:export': async (r) => (await refs()).exportRefs(s, r, async (ids) => (await (await linking()).withKeys(await s.runtime.require(), ids)).map((x) => ({ doc: x.doc, key: x.key }))),
  'bib:saveText': async (r) => (await refs()).saveText(s, r),
  'bib:prismaGet': async (r) => (await prisma()).getPrisma(s, r.projectId),
  'bib:prismaSet': async (r) => (await prisma()).setPrisma(s, r.projectId, r.counts),
});

/** After a change of a project: rewrites its linked .bib file. A project without a link loads nothing. */
export async function syncLinkedBib(s: MainServices, projectId: string): Promise<void> {
  try {
    const p = await (await s.runtime.require()).store.projects.get(projectId);
    if (p?.bibLink) await (await linking()).sync(s, projectId);
  } catch (e) {
    s.log.warn('updating the linked .bib file failed', { error: e });
  }
}
