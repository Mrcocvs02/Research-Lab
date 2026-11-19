import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '../../components/Dialog';

/** "Model options…" (from the `⋯`): the seed of the layout and the rebuild. The seed is nowhere else on the page. */
export function ModelOptions({ seedHint, busy, onClose, onBuild }: { seedHint: number | null; busy: boolean; onClose(): void; onBuild(seed?: number): void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const seed = /^\d{1,10}$/.test(text.trim()) && Number(text) <= 2_147_483_647 ? Number(text) : undefined;
  const bad = text.trim() !== '' && seed === undefined;
  return (
    <Dialog title={t('network.options.title')} onClose={onClose} testId="model-options">
      <div className="net-pop-body">
        <label className="net-field net-pop-row">
          <span>{t('network.seed')}</span>
          <input type="text" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} placeholder={seedHint !== null ? String(seedHint) : t('network.seedAuto')} aria-invalid={bad || undefined} data-testid="graph-seed" size={10} />
        </label>
        <p className="hint">{t('network.options.seedHelp')}</p>
        <div className="net-toolbar">
          <button
            type="button"
            className="primary"
            disabled={bad || busy}
            onClick={() => {
              onBuild(seed);
              onClose();
            }}
            data-testid="graph-build-options"
          >
            {t('network.rebuild')}
          </button>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
