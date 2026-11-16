import { useTranslation } from 'react-i18next';
import { useHistory } from './history';

export function HistoryPanel({ id, onClose }: { id: string; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const h = useHistory();
  const time = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(i18n.language);
  };
  return (
    <div className="history-panel" id={id} role="region" aria-label={t('history.title')} data-testid="history-panel" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="history-head">
        <h2>{t('history.title')}</h2>
        <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {h.items.length === 0 ? (
        <p className="hint" data-testid="history-empty">
          {t('history.empty')}
        </p>
      ) : (
        <ol className="history-list">
          {h.items.map((item) => (
            <li key={item.changeId} className={item.undone ? 'history-item undone' : 'history-item'} data-testid="history-item" data-change-id={item.changeId} data-action={item.action}>
              <div className="history-line">
                <span className="history-summary">
                  {t(`history.actions.${item.action.replaceAll(".", "_")}`, { defaultValue: item.summary, documents: item.counts.documents, tags: item.counts.taxonomy, projects: item.counts.projects })}
                </span>
                {item.actor === 'ai' && <span className="ai-badge">{t('ai.badge')}</span>}
              </div>
              <div className="history-meta">
                <span>{time(item.at)}</span>
                {item.kind !== 'change' && <span className="badge">{t(`history.kind.${item.kind}`)}</span>}
                {item.undone && <span className="badge">{t('history.undoneBadge')}</span>}
                {!item.mine && <span className="badge">{t('history.otherDevice')}</span>}
                {item.undoable && !item.undone && item.mine && (
                  <button type="button" className="link" disabled={h.busy} onClick={() => void h.undo(item.changeId)} data-testid="history-undo-item">
                    {t('history.undoThis')}
                  </button>
                )}
                {item.undone && item.mine && (
                  <button type="button" className="link" disabled={h.busy} onClick={() => void h.redo(item.changeId)} data-testid="history-redo-item">
                    {t('history.redoThis')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
