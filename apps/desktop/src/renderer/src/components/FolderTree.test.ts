// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { FolderTree, type FolderEntry } from './FolderTree';

const tree: Record<string, FolderEntry[]> = {
  '': [
    { path: 'a', name: 'a', hasChildren: true },
    { path: 'b', name: 'b', hasChildren: false },
  ],
  a: [{ path: 'a/x', name: 'x', hasChildren: false }],
};
const load = vi.fn(async (parent: string) => tree[parent] ?? []);

function Harness({ onChange }: { onChange: (v: string[]) => void }) {
  const [value, setValue] = useState<string[]>([]);
  return createElement(FolderTree, {
    load,
    value,
    ariaLabel: 'folders',
    onChange: (v: string[]) => {
      setValue(v);
      onChange(v);
    },
  });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  load.mockClear();
});

describe('FolderTree', () => {
  it('starts with nothing selected and loads children only when expanded', async () => {
    render(createElement(Harness, { onChange: () => {} }));
    const boxes = (await screen.findAllByRole('checkbox')) as HTMLInputElement[];
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /contents of a/ }));
    await screen.findByLabelText('x');
    expect(load).toHaveBeenCalledWith('a');
  });

  it('a selected folder includes its sub-folders, which are shown checked and locked', async () => {
    const onChange = vi.fn();
    render(createElement(Harness, { onChange }));
    fireEvent.click(await screen.findByRole('button', { name: /contents of a/ }));
    const child = (await screen.findByLabelText('x')) as HTMLInputElement;
    fireEvent.click(screen.getByLabelText('a'));
    expect(onChange).toHaveBeenLastCalledWith(['a']);
    expect(child.checked).toBe(true);
    expect(child.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('b'));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.click(screen.getByLabelText('a'));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
    expect(child.disabled).toBe(false);
  });
});
