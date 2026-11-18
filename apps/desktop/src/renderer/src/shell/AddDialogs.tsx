import { Lazy, lazyView } from '../components/Lazy';
import { requestAdd, useAddRequest } from '../lib/addRequest';

// The two add dialogs (and their strings) load the first time one is asked for.
const IdDialog = lazyView(() => import('../views/import/IdDialog'), ['resources']);
const ResourceDialog = lazyView(() => import('../views/resources/ResourceDialog'), ['resources']);

/** Shows the add dialog somebody asked for (`lib/addRequest`). */
export function AddDialogs() {
  const req = useAddRequest();
  if (!req) return null;
  const close = () => requestAdd(null);
  return <Lazy>{req.kind === 'id' ? <IdDialog initialText={req.text ?? ''} onClose={close} /> : <ResourceDialog {...(req.docId ? { docId: req.docId } : {})} onClose={close} />}</Lazy>;
}
