import { useEffect, useState } from 'react';
import type { CostEstimate } from '../../components/AiCostPreview';
import { rl } from '../../lib/rl';

/**
 * The estimate of "✦ Spiega" for a passage, asked of main (which sends nothing) a moment after the passage settles, so the
 * button can show "≈ 900 token · Haiku" before the click (D-416). `null` while it is unknown or when the call fails: the
 * button then shows only its name, and the click still goes through the rule of cost.
 */
export function useExplainEstimate(docId: string, req: { page: number; text: string; around: string } | null): CostEstimate | null {
  const [est, setEst] = useState<CostEstimate | null>(null);
  const key = req ? `${req.page}|${req.text}|${req.around}` : '';
  useEffect(() => {
    setEst(null);
    if (!req || req.text.trim() === '') return;
    let alive = true;
    const timer = setTimeout(() => {
      rl.invoke('explain:estimate', { docId, page: req.page, text: req.text, around: req.around, detail: false }).then(
        (e) => alive && setEst(e),
        () => {},
      );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, key]);
  return est;
}
