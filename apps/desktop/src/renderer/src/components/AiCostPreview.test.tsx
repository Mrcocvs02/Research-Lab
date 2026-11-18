// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { loadStrings } from '../i18n';
import { AiCostPreview, costGate, costLabel, dayShareText, type CostEstimate } from './AiCostPreview';

const est: CostEstimate = { model: 'claude-haiku-5-5', approxTokens: 900, estimatedUsd: 0.001, cached: false, folderEnabled: true, firstFolderSend: false, thresholdTokens: 5000, needsDialog: false, todayTokens: 1000, dailyCap: 5000, overDailyCap: false, todayPct: 38 };

beforeEach(async () => {
  await i18n.changeLanguage('en');
  await loadStrings(['reader']);
});
afterEach(cleanup);
const t = (k: string) => i18n.t(k);

describe('AiCostPreview rule (D-416)', () => {
  it('decides what a click does', () => {
    expect(costGate(est)).toBe('send');
    expect(costGate({ ...est, needsDialog: true })).toBe('dialog');
    expect(costGate({ ...est, needsDialog: true, overDailyCap: true })).toBe('cap');
    expect(costGate({ ...est, folderEnabled: false })).toBe('not-enabled');
    expect(costGate({ ...est, cached: true, needsDialog: true })).toBe('send');
  });
  it('puts the estimate in the button under the threshold', () => {
    expect(costLabel(i18n.t, 'Explain', est, 'Haiku 5.5')).toBe('Explain · ≈ 900 tokens · Haiku 5.5');
    expect(costLabel(i18n.t, 'Explain', null, 'Haiku 5.5')).toBe('Explain');
    expect(costLabel(i18n.t, 'Explain', { ...est, cached: true }, 'Haiku 5.5')).toBe('Explain · Ready, nothing sent');
  });
  it("shows the share of the day's cap", () => {
    expect(dayShareText(i18n.t, est)).toBe('Today: 38 % of the cap used');
    expect(dayShareText(i18n.t, { ...est, todayPct: null })).toBeNull();
    expect(t('reader.cost.title')).toBe('Send to Claude?');
  });
});

describe('AiCostPreview dialog', () => {
  const models = [
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  ];
  const props = { what: 'The selected text.', requests: 1, modelLabel: 'Haiku 5.5', models, model: 'claude-haiku-5-5' };
  it('shows what goes, the requests, the tokens and the day share, and confirms', () => {
    const onConfirm = vi.fn();
    render(<AiCostPreview {...props} estimate={{ ...est, needsDialog: true, approxTokens: 6200, firstFolderSend: true }} onModel={() => {}} onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.getByTestId('ai-cost-what').textContent).toBe('The selected text.');
    expect(screen.getByTestId('ai-cost-tokens').textContent).toContain('6.2k');
    expect(screen.getByTestId('ai-cost-today').textContent).toContain('38 %');
    expect(screen.getByTestId('ai-cost-first')).toBeTruthy();
    expect(screen.getByTestId('ai-cost-over')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ai-cost-confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
  it('past the cap of the day the send is disabled and another model can be chosen', () => {
    const onModel = vi.fn();
    render(<AiCostPreview {...props} estimate={{ ...est, overDailyCap: true, needsDialog: true }} onModel={onModel} onConfirm={() => {}} onCancel={() => {}} />);
    expect((screen.getByTestId('ai-cost-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('ai-cost-cap')).toBeTruthy();
    fireEvent.change(screen.getByTestId('ai-cost-model'), { target: { value: 'claude-sonnet-5-5' } });
    expect(onModel).toHaveBeenCalledWith('claude-sonnet-5-5');
  });
});
