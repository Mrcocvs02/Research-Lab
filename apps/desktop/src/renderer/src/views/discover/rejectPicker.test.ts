// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { RejectPicker } from './Searches';

afterEach(cleanup);

describe('reason of a rejection (PRISMA)', () => {
  it('sends the code of the chosen reason, and cancels without sending', () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    render(createElement(RejectPicker, { onPick, onCancel }));
    fireEvent.click(screen.getByTestId('run-reject-confirm'));
    expect(onPick).toHaveBeenLastCalledWith('off-topic');
    fireEvent.change(screen.getByTestId('run-reject-reason'), { target: { value: 'wrong-language' } });
    fireEvent.click(screen.getByTestId('run-reject-confirm'));
    expect(onPick).toHaveBeenLastCalledWith('wrong-language');
    fireEvent.click(screen.getByTestId('run-reject-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  it('keeps the free text of "other" (trimmed), and "other" itself when it is empty', () => {
    const onPick = vi.fn();
    render(createElement(RejectPicker, { onPick, onCancel: () => {} }));
    expect(screen.queryByTestId('run-reject-text')).toBeNull();
    fireEvent.change(screen.getByTestId('run-reject-reason'), { target: { value: 'other' } });
    fireEvent.click(screen.getByTestId('run-reject-confirm'));
    expect(onPick).toHaveBeenLastCalledWith('other');
    fireEvent.change(screen.getByTestId('run-reject-text'), { target: { value: '  Preprint only  ' } });
    fireEvent.click(screen.getByTestId('run-reject-confirm'));
    expect(onPick).toHaveBeenLastCalledWith('Preprint only');
  });
});
