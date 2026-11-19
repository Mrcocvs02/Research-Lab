import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceView } from '@rl/core';
import { Button } from '../../components/Button';
import { requestAdd } from '../../lib/addRequest';
import { errorMessage } from '../../lib/errors';
import { useChangeVersion } from '../../lib/events';
import { useNotify } from '../../lib/notify';
import { rl } from '../../lib/rl';
import { safeText } from '../library/safeText';
import { KIND_GLYPH, openFailure } from './model';
import './resources.css';

/** "File and resources" of the document card (17.4.4): the resources linked to the document, and "+ Link a resource". */
export default function DocResources({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const { info, fail } = useNotify();
  const version = useChangeVersion('documents');
  const [items, setItems] = useState<ResourceView[]>([]);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let live = true;
    rl.invoke('resources:list', { docId }).then(
      (r) => live && setItems(r.items),
      () => live && setItems([]),
    );
    return () => {
      live = false;
    };
  }, [docId, version, bump]);
  const unlink = useCallback(
    (r: ResourceView) =>
      void rl.invoke('resources:update', { id: r.id, docIds: r.docs.filter((d) => d !== docId) }).then(
        () => (info(t('resources.card.unlinked')), setBump((n) => n + 1)),
        (e: unknown) => fail(errorMessage(e, t)),
      ),
    [docId, info, fail, t],
  );
  return (
    <div className="card-resources" data-testid="doc-resources">
      {items.length === 0 && <p className="hint">{t('resources.card.empty')}</p>}
      {items.map((r) => (
        <div key={r.id} className="card-resources__row" data-testid="doc-resource">
          <span>
            <span aria-hidden="true">{KIND_GLYPH[r.kind]}</span> {safeText(r.title)}
            {r.host ? <span className="hint"> · {r.host}</span> : null}
          </span>
          <span>
            <Button size="sm" disabled={r.missing} onClick={() => void rl.invoke('resources:open', { id: r.id }).catch((e: unknown) => fail(openFailure(e, t)))} data-testid="doc-resource-open">
              {t('resources.open')}
            </Button>{' '}
            <Button size="sm" variant="ghost" onClick={() => unlink(r)} data-testid="doc-resource-unlink">
              {t('resources.card.unlink')}
            </Button>
          </span>
        </div>
      ))}
      <div>
        <Button size="sm" variant="ghost" onClick={() => requestAdd({ kind: 'resource', docId })} data-testid="doc-resource-link">
          {t('resources.card.link')}
        </Button>
      </div>
    </div>
  );
}
