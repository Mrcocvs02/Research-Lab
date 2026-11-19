import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReasoningLevel } from '@rl/core';
import { Button } from '../../components/Button';
import { IconChevronDown, IconPlus } from '../../components/icons';
import { Lazy, lazyView } from '../../components/Lazy';
import { Menu } from '../../components/Menu';
import { Segmented } from '../../components/Segmented';
import { useInbox } from '../../lib/inbox';
import { useApp } from '../../state/app-context';
import { useReviewDocs } from '../../shell/useReviewDocs';
import { Arrivals } from '../inbox/Arrivals';
import { TaxonomyProvider } from '../library/useTaxonomy';
import '../inbox/inbox.css';

const ReviewView = lazyView(() => import('./ReviewView').then((m) => ({ default: m.ReviewView })), ['doc-review', 'review']);

type Tab = 'arrivals' | 'proposals';
const REASONING: ReasoningLevel[] = ['low', 'medium', 'high'];

/** A header chip that opens a short menu; the menu heading says what the choice is for (N22, D-362). */
function ChoiceChip({ text, heading, value, options, onPick, testId }: { text: string; heading: string; value: string; options: Array<{ id: string; label: string }>; onPick(id: string): void; testId: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span ref={anchor}>
        <Button size="sm" aria-haspopup="menu" aria-expanded={open} title={heading} onClick={() => setOpen(!open)} data-testid={testId}>
          {text}
          <IconChevronDown size={16} />
        </Button>
      </span>
      <Menu
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label={text}
        width={260}
        groups={[{ id: 'choice', label: heading, items: options.map((o) => ({ id: o.id, label: o.id === value ? `✓ ${o.label}` : o.label, onSelect: () => onPick(o.id) })) }]}
      />
    </>
  );
}

/**
 * "To review" (lazy): one hub with the new files (from outside and found by the scan) and Claude's proposals. The header
 * says how many files wait, holds the one primary action, and the two chips (model and reasoning) that only matter for
 * the proposals Claude makes on new files.
 */
export function ReviewHub({ tab, onTab }: { tab: Tab; onTab(t: Tab): void }) {
  const { t } = useTranslation();
  const { config } = useApp();
  const inbox = useInbox();
  const proposalDocs = useReviewDocs();
  const models = config?.ai.models ?? [];
  const [modelChoice, setModel] = useState<string | null>(null);
  const [reasoningChoice, setReasoning] = useState<ReasoningLevel | null>(null);
  const model = modelChoice ?? config?.ai.defaultModel ?? models[0]?.id ?? '';
  const reasoning = reasoningChoice ?? config?.ai.defaultReasoning ?? 'low';
  const modelName = models.find((m) => m.id === model)?.label || model;

  return (
    <TaxonomyProvider>
      <div className="view rh-page" data-testid="section-inbox">
        <header className="rh-head">
          <h1>{t('sections.inbox')}</h1>
          {tab === 'arrivals' && inbox.count > 0 && <span className="rh-count">{t('inbox.hubCount', { count: inbox.count })}</span>}
          <div className="rh-head__acts">
            {tab === 'arrivals' && (
              <>
                <ChoiceChip
                  text={t('inbox.modelChip', { name: modelName })}
                  heading={t('inbox.chipsHelp')}
                  value={model}
                  options={models.map((m) => ({ id: m.id, label: m.label || m.id }))}
                  onPick={setModel}
                  testId="inbox-model"
                />
                <ChoiceChip
                  text={t('inbox.reasoningChip', { level: t(`inbox.reasoning_${reasoning}`) })}
                  heading={t('inbox.chipsHelp')}
                  value={reasoning}
                  options={REASONING.map((r) => ({ id: r, label: t(`inbox.reasoning_${r}`) }))}
                  onPick={(r) => setReasoning(r as ReasoningLevel)}
                  testId="inbox-reasoning"
                />
              </>
            )}
            <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => void inbox.choose()} title={t('inbox.dropHelp')} data-testid="inbox-add">
              {t('inbox.add')}
            </Button>
          </div>
        </header>
        <Segmented<Tab>
          label={t('inbox.tabs')}
          value={tab}
          onChange={onTab}
          options={[
            { value: 'arrivals', label: t('inbox.tab_arrivals', { count: inbox.count }), testId: 'inbox-tab-arrivals' },
            { value: 'proposals', label: t('inbox.tab_proposals', { count: proposalDocs }), testId: 'inbox-tab-proposals' },
          ]}
        />
        <div className="rh-panel">
          {tab === 'arrivals' ? (
            <Arrivals model={model} reasoning={reasoning} models={models} />
          ) : (
            <Lazy>
              <ReviewView />
            </Lazy>
          )}
        </div>
      </div>
    </TaxonomyProvider>
  );
}
