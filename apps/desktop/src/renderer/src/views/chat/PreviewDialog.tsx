import { useTranslation } from 'react-i18next';
import type { ModelConfig } from '@rl/core';
import { Dialog } from '../../components/Dialog';
import { safeText } from '../library/safeText';
import { formatTokens, formatUsd } from './format';
import type { AiPreview } from './useChat';
import { useDocTitle } from './useLabels';

function DocLine({ docId, reason, label }: { docId: string; reason?: AiPreview['refused'][number]['reason']; label?: string | undefined }) {
  const { t } = useTranslation();
  const title = useDocTitle(docId);
  return (
    <li data-testid={reason ? 'preview-refused' : 'preview-allowed'} data-doc-id={docId}>
      {safeText(label ?? title ?? docId.slice(0, 8))}
      {reason && <span className="hint"> — {t(`chat.preview.reason_${reason}`)}</span>}
    </li>
  );
}

/** What is about to be sent to which model, shown before the send and confirmed by the user (docs/RULES.md, rule 4). */
export function PreviewDialog({ preview, models, onConfirm, onCancel, busy, labels, title, confirmLabel, agent }: { preview: AiPreview; models: ModelConfig[]; onConfirm(): void; onCancel(): void; busy: boolean; labels?: Record<string, string>; title?: string; confirmLabel?: string; /** A chat: the agent may also read the folders listed (D-227). */ agent?: boolean }) {
  const { t } = useTranslation();
  const model = models.find((m) => m.id === preview.model)?.label ?? preview.model;
  return (
    <Dialog title={title ?? t('chat.preview.title')} onClose={onCancel} testId="send-preview">
      <div className="dialog-body">
        <p data-testid="preview-intro">{agent && preview.allowed.length === 0 ? t('chat.preview.introAgent', { model }) : t('chat.preview.intro', { model })}</p>
        {!(agent && preview.allowed.length === 0) && <h3>{t('chat.preview.allowed', { count: preview.allowed.length })}</h3>}
        {preview.allowed.length === 0 ? (
          agent ? null : <p className="hint">{t('chat.preview.noneAllowed')}</p>
        ) : (
          <ul className="preview-docs">
            {preview.allowed.map((id) => (
              <DocLine key={id} docId={id} label={labels?.[id]} />
            ))}
          </ul>
        )}
        {preview.refused.length > 0 && (
          <>
            <h3>{t('chat.preview.refused', { count: preview.refused.length })}</h3>
            <ul className="preview-docs" data-testid="preview-refused-list">
              {preview.refused.map((r) => (
                <DocLine key={r.docId} docId={r.docId} reason={r.reason} label={labels?.[r.docId]} />
              ))}
            </ul>
          </>
        )}
        {preview.folders.length > 0 && (
          <p data-testid="preview-folders">
            {agent ? t('chat.preview.agentFolders') : t('chat.preview.folders')} {preview.folders.map((f) => safeText(f || '/')).join(', ')}
          </p>
        )}
        <p data-testid="preview-size">
          {t('chat.preview.tokens', { tokens: formatTokens(preview.approxInputTokens) })} ·{' '}
          {preview.estimatedUsd === null ? t('chat.preview.noPrice') : t('chat.preview.cost', { usd: formatUsd(preview.estimatedUsd) })}
        </p>
        <p className="hint">{t('chat.preview.note')}</p>
      </div>
      <div className="actions">
        <button type="button" onClick={onCancel} data-testid="preview-cancel">
          {t('common.cancel')}
        </button>
        <button type="button" className="primary" onClick={onConfirm} disabled={busy} data-testid="preview-confirm">
          {confirmLabel ?? t('chat.preview.send')}
        </button>
      </div>
    </Dialog>
  );
}
