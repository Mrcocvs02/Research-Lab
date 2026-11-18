import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Annotation, CropMeta } from '@rl/core';
import { Floating, type Anchor } from './AnnotationPopover';

export const CROP_TYPES = ['figure', 'table', 'equation', 'other'] as const;

/**
 * A crop was clicked (§17.4.8): its type (Figure · Table · Equation · Other), a caption, Copy image and ✦ Explain. The
 * caption is kept when the field loses the focus or Enter is pressed. Deleting a crop never touches the document.
 */
export function CropPopover({
  annotation,
  anchor,
  busy,
  explainLabel,
  explainDisabled,
  onType,
  onCaption,
  onCopyImage,
  onExplain,
  onDelete,
}: {
  annotation: Annotation;
  anchor: () => Anchor | null;
  busy: boolean;
  explainLabel: string;
  /** The reason ✦ Explain cannot be used now (no text to send); it is the tooltip and the entry stays visible. */
  explainDisabled?: string | undefined;
  onType(type: CropMeta['type']): void;
  onCaption(caption: string): void;
  onCopyImage(): void;
  onExplain(): void;
  onDelete(): void;
}) {
  const { t } = useTranslation();
  const type = annotation.crop?.type ?? 'figure';
  const saved = annotation.crop?.caption ?? '';
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved, annotation.id]);
  const commit = () => {
    if (draft.trim() !== saved.trim()) onCaption(draft.trim());
  };
  return (
    <Floating anchor={anchor} label={t('reader.crop.popover')} testId="crop-popover" mode="crop" className="crop-pop">
      <div className="ann-pop__row" role="radiogroup" aria-label={t('reader.crop.type')}>
        {CROP_TYPES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={type === c} className={type === c ? 'is-on' : undefined} disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => type !== c && onType(c)} data-testid={`crop-type-${c}`}>
            {t(`reader.crop.types.${c}`)}
          </button>
        ))}
      </div>
      <div className="ann-pop__row">
        <input
          type="text"
          className="ann-comment"
          value={draft}
          maxLength={500}
          placeholder={t('reader.crop.captionPlaceholder')}
          aria-label={t('reader.crop.caption')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          data-testid="crop-caption"
        />
      </div>
      <div className="ann-pop__row">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCopyImage} data-testid="crop-copy-image">
          {t('reader.crop.copyImage')}
        </button>
        <button type="button" aria-disabled={explainDisabled ? true : undefined} title={explainDisabled} onMouseDown={(e) => e.preventDefault()} onClick={() => !explainDisabled && onExplain()} data-testid="crop-explain">
          {explainLabel}
        </button>
        <button type="button" className="danger" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onDelete} title={`${t('reader.ann.delete')} (Del)`} data-testid="crop-delete">
          {t('reader.ann.delete')}
        </button>
      </div>
    </Floating>
  );
}
