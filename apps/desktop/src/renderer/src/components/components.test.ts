// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { Badge } from './Badge';
import { Banner } from './Banner';
import { Button } from './Button';
import { Chip } from './Chip';
import { Drawer } from './Drawer';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';
import { IconLibrary, IconSearch } from './icons-shell';
import { IconPlus } from './icons';
import { Kbd } from './Kbd';
import { KeyValue } from './KeyValue';
import { checkMenu, Menu, type MenuGroups } from './Menu';
import { placePopover, Popover } from './Popover';
import { ProgressBar, ProgressRing } from './Progress';
import { Segmented } from './Segmented';
import { Switch } from './Switch';
import { Tabs, tabIds } from './Tabs';
import { Toast, ToastRegion } from './Toast';

// Loosely typed createElement: the tests pass children as the third argument next to required-children props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = createElement as (type: any, props?: any, ...children: any[]) => ReactElement;

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(cleanup);

describe('Button', () => {
  it('renders each variant and size as classes and defaults to a secondary md button of type button', () => {
    render(h(Button, null, 'Save'));
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b.className).toContain('rl-btn--secondary');
    expect(b.className).toContain('rl-btn--md');
    expect(b.getAttribute('type')).toBe('button');
    cleanup();
    render(h(Button, { variant: 'primary', size: 'lg' }, 'Go'));
    expect(screen.getByRole('button').className).toContain('rl-btn--primary rl-btn--lg');
  });

  it('a disabled button is really disabled, takes no clicks and shows its reason as the tooltip', () => {
    const onClick = vi.fn();
    render(h(Button, { disabled: true, disabledReason: 'Select 2 documents', onClick }, 'Compare'));
    const b = screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('Select 2 documents');
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('busy sets aria-busy, swaps the icon for a spinner, keeps the text and ignores clicks', () => {
    const onClick = vi.fn();
    render(h(Button, { busy: true, icon: h(IconPlus, { size: 16 }), onClick }, 'Create'));
    const b = screen.getByRole('button', { name: 'Create' });
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.querySelector('.rl-ring--spin')).not.toBeNull();
    expect(b.querySelector('svg:not(.rl-ring)')).toBeNull();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('an enabled, idle button clicks and has no aria-busy', () => {
    const onClick = vi.fn();
    render(h(Button, { onClick }, 'Ok'));
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').hasAttribute('aria-busy')).toBe(false);
  });
});

describe('IconButton', () => {
  it('has the label as accessible name and the shortcut in the tooltip', () => {
    render(h(IconButton, { label: 'Search', keys: 'Ctrl+K' }, h(IconSearch)));
    const b = screen.getByRole('button', { name: 'Search' });
    expect(b.title).toBe('Search (Ctrl+K)');
  });

  it('a toggle exposes aria-pressed and the pressed class; a disabled one gives its reason', () => {
    render(h(IconButton, { label: 'Panel', pressed: true }, h(IconLibrary)));
    const b = screen.getByRole('button', { name: 'Panel' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.className).toContain('is-pressed');
    cleanup();
    render(h(IconButton, { label: 'Undo', disabled: true, disabledReason: 'Nothing to undo' }, h(IconLibrary)));
    expect((screen.getByRole('button') as HTMLButtonElement).title).toBe('Undo: Nothing to undo');
  });

  it('icons are decorative by default and sized 20 (16 and 24 on request)', () => {
    const { container } = render(h('div', null, h(IconLibrary), h(IconSearch, { size: 16 }), h(IconPlus, { size: 24 })));
    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs.map((s) => s.getAttribute('width'))).toEqual(['20', '16', '24']);
    expect(svgs.every((s) => s.getAttribute('aria-hidden') === 'true' && s.getAttribute('stroke-width') === '1.75')).toBe(true);
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'list', label: 'List' },
    { value: 'grid', label: 'Grid', disabled: true, disabledReason: 'Not available' },
    { value: 'map', label: 'Map' },
  ] as const;

  it('is a radiogroup with one checked radio and a roving tab stop', () => {
    render(h(Segmented, { options, value: 'list', onChange: () => {}, label: 'View' }));
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('arrows move to the next enabled option, skipping the disabled one, and wrap', () => {
    const onChange = vi.fn();
    render(h(Segmented, { options, value: 'list', onChange, label: 'View' }));
    fireEvent.keyDown(screen.getByRole('radio', { name: 'List' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('map');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'List' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('map');
  });

  it('a disabled option cannot be chosen and tells why', () => {
    const onChange = vi.fn();
    render(h(Segmented, { options, value: 'list', onChange, label: 'View' }));
    const grid = screen.getByRole('radio', { name: 'Grid' }) as HTMLButtonElement;
    expect(grid.disabled).toBe(true);
    expect(grid.title).toBe('Not available');
    fireEvent.click(grid);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Switch', () => {
  it('is a switch named by its label, toggles with a click and reflects aria-checked', () => {
    const Harness = () => {
      const [on, setOn] = useState(false);
      return h(Switch, { checked: on, onChange: setOn, label: 'Dark theme' });
    };
    render(h(Harness));
    const s = screen.getByRole('switch', { name: 'Dark theme' });
    expect(s.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(s);
    expect(s.getAttribute('aria-checked')).toBe('true');
    expect(s.className).toContain('is-on');
  });

  it('disabled: no toggle, reason as tooltip', () => {
    const onChange = vi.fn();
    render(h(Switch, { checked: false, onChange, label: 'Sync', disabled: true, disabledReason: 'Offline' }));
    const s = screen.getByRole('switch') as HTMLButtonElement;
    fireEvent.click(s);
    expect(onChange).not.toHaveBeenCalled();
    expect(s.title).toBe('Offline');
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'Plan' },
    { id: 'b', label: 'Notes' },
    { id: 'c', label: 'Schema', disabled: true, disabledReason: 'After first use' },
  ];

  it('has a tablist, one selected tab, and ids that link to the panel', () => {
    render(h(Tabs, { tabs, value: 'a', onChange: () => {}, label: 'Project', idBase: 'p' }));
    expect(screen.getByRole('tablist', { name: 'Project' })).toBeTruthy();
    const a = screen.getByRole('tab', { name: 'Plan' });
    expect(a.getAttribute('aria-selected')).toBe('true');
    expect(a.getAttribute('aria-controls')).toBe(tabIds('p', 'a').panelId);
    expect(a.id).toBe(tabIds('p', 'a').tabId);
  });

  it('arrows, Home and End move between enabled tabs', () => {
    const onChange = vi.fn();
    render(h(Tabs, { tabs, value: 'a', onChange, label: 'Project' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Plan' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Plan' }), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Notes' }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('a disabled tab cannot be activated and tells why', () => {
    const onChange = vi.fn();
    render(h(Tabs, { tabs, value: 'a', onChange, label: 'Project' }));
    const c = screen.getByRole('tab', { name: 'Schema' }) as HTMLButtonElement;
    fireEvent.click(c);
    expect(onChange).not.toHaveBeenCalled();
    expect(c.title).toBe('After first use');
  });
});

describe('Chip', () => {
  it('a filter chip is a toggle button; selecting is aria-pressed', () => {
    const onClick = vi.fn();
    render(h(Chip, { selected: true, onClick }, 'PDF'));
    const b = screen.getByRole('button', { name: 'PDF' });
    expect(b.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a removable filter chip has a named remove button', () => {
    const onRemove = vi.fn();
    render(h(Chip, { onRemove, removeLabel: 'Remove filter PDF' }, 'PDF'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter PDF' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('status and tag chips are not buttons; the tag has a dot in the node colour', () => {
    const { container } = render(h('div', null, h(Chip, { kind: 'status', tone: 'success' }, 'Done'), h(Chip, { kind: 'tag', dotColor: 'var(--cat-2)' }, 'ml')));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelector('.rl-chip--success')).not.toBeNull();
    expect((container.querySelector('.rl-chip__dot') as HTMLElement).style.background).toBe('var(--cat-2)');
  });

  it('a disabled filter chip cannot be clicked', () => {
    const onClick = vi.fn();
    render(h(Chip, { disabled: true, onClick }, 'PDF'));
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Badge, Kbd, KeyValue, EmptyState, Progress', () => {
  it('Badge caps counts and has a variant per kind', () => {
    const { container } = render(h('div', null, h(Badge, { value: 7 }), h(Badge, { value: 120 }), h(Badge, { kind: 'warning' }, 'Review'), h(Badge, { kind: 'ai' }, 'AI'), h(Badge, { kind: 'type', fileKind: 'pdf' }, 'pdf')));
    expect([...container.querySelectorAll('.rl-badge--count')].map((n) => n.textContent)).toEqual(['7', '99+']);
    expect(container.querySelector('.rl-badge--warning')).not.toBeNull();
    expect(container.querySelector('.rl-badge--ai')).not.toBeNull();
    expect(container.querySelector('.rl-badge--type.rl-badge--pdf')).not.toBeNull();
  });

  it('Kbd renders a kbd element', () => {
    render(h(Kbd, null, 'Ctrl+K'));
    expect(screen.getByText('Ctrl+K').tagName).toBe('KBD');
  });

  it('KeyValue is a definition list with one term and one definition per row', () => {
    const { container } = render(h(KeyValue, { items: [{ label: 'Year', value: '2024' }, { label: 'Pages', value: 12 }] }));
    expect(container.querySelectorAll('dl > div > dt')).toHaveLength(2);
    expect(container.querySelectorAll('dl > div > dd')).toHaveLength(2);
    expect(container.querySelector('dd')?.textContent).toBe('2024');
  });

  it('EmptyState has a heading, text and one action', () => {
    render(h(EmptyState, { icon: h(IconLibrary, { size: 24 }), title: 'No documents', action: h(Button, { variant: 'primary' }, 'Add folder') }, 'Add a folder to start.'));
    expect(screen.getByRole('heading', { name: 'No documents' })).toBeTruthy();
    expect(screen.getByText('Add a folder to start.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add folder' })).toBeTruthy();
  });

  it('ProgressBar and ProgressRing expose their value (or none when indeterminate)', () => {
    render(h(ProgressBar, { value: 0.42, label: 'Scan' }));
    expect(screen.getByRole('progressbar', { name: 'Scan' }).getAttribute('aria-valuenow')).toBe('42');
    cleanup();
    render(h(ProgressBar, { label: 'Scan' }));
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
    cleanup();
    const { container } = render(h(ProgressRing, { value: 0.5 }));
    expect(container.querySelector('svg')?.getAttribute('aria-valuenow')).toBe('50');
  });
});

describe('placePopover', () => {
  const vp = { width: 1000, height: 700 };
  const size = { width: 200, height: 150 };

  it('opens below, aligned to the start of the anchor', () => {
    expect(placePopover({ top: 100, left: 300, width: 80, height: 32 }, size, vp)).toMatchObject({ top: 136, left: 300, flipped: false });
  });

  it('flips above when there is no room below and there is above', () => {
    const p = placePopover({ top: 600, left: 300, width: 80, height: 32 }, size, vp);
    expect(p.flipped).toBe(true);
    expect(p.top).toBe(600 - 4 - 150);
  });

  it('aligns to the end edge for -end and stays inside the viewport horizontally', () => {
    expect(placePopover({ top: 100, left: 700, width: 80, height: 32 }, size, vp, 'bottom-end').left).toBe(580);
    expect(placePopover({ top: 100, left: 950, width: 40, height: 32 }, size, vp).left).toBe(1000 - 200 - 8);
    expect(placePopover({ top: 100, left: -30, width: 40, height: 32 }, size, vp).left).toBe(8);
  });

  it('prefers above for top placements when it fits', () => {
    expect(placePopover({ top: 400, left: 100, width: 80, height: 32 }, size, vp, 'top-start')).toMatchObject({ top: 400 - 4 - 150, flipped: false });
  });
});

function MenuHarness({ groups, onSelect }: { groups: MenuGroups; onSelect?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return h('div', null, h('button', { ref, type: 'button', onClick: () => setOpen((o) => !o) }, 'More'), h(Menu, { anchor: ref, open, onClose: () => setOpen(false), groups, label: 'Actions', ...(onSelect ? {} : {}) }));
}

describe('Menu (rule of D-412: at most 7 items in 3 groups, disabled with a reason, never hidden)', () => {
  const item = (id: string, extra: object = {}) => ({ id, label: id.toUpperCase(), onSelect: () => {}, ...extra });

  it('checkMenu accepts 7 items in 3 groups and rejects more of either', () => {
    const ok: MenuGroups = [
      { id: 'g1', items: [item('a'), item('b'), item('c')] },
      { id: 'g2', items: [item('d'), item('e')] },
      { id: 'g3', items: [item('f'), item('g')] },
    ];
    expect(checkMenu(ok)).toEqual([]);
    expect(checkMenu([...ok, { id: 'g4', items: [item('h')] }]).join()).toContain('4 groups');
    expect(checkMenu([{ id: 'g', items: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => item(x)) }]).join()).toContain('8 items');
  });

  it('checkMenu rejects a disabled item without a reason, empty groups and duplicate ids', () => {
    expect(checkMenu([{ id: 'g', items: [item('a', { disabled: true }) as never] }]).join()).toContain('without a reason');
    expect(checkMenu([{ id: 'g', items: [] }]).join()).toContain('empty');
    expect(checkMenu([{ id: 'g', items: [item('a'), item('a')] }]).join()).toContain('duplicate');
  });

  it('renders a menu with items and separators between groups; disabled items stay visible with the reason', () => {
    const groups: MenuGroups = [
      { id: 'g1', items: [item('open'), item('compare', { disabled: true, disabledReason: 'Select 2 documents' }) as never] },
      { id: 'g2', items: [item('delete', { danger: true })] },
    ];
    render(h(MenuHarness, { groups }));
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    const compare = screen.getByRole('menuitem', { name: 'COMPARE' });
    expect(compare.getAttribute('aria-disabled')).toBe('true');
    expect(compare.title).toBe('Select 2 documents');
  });

  it('arrow keys move the focus (wrapping), Tab stays inside, Enter selects and closes', () => {
    const onA = vi.fn();
    const onB = vi.fn();
    const groups: MenuGroups = [{ id: 'g', items: [item('a', { onSelect: onA }), item('b', { onSelect: onB })] }];
    render(h(MenuHarness, { groups }));
    const [a, b] = screen.getAllByRole('menuitem') as [HTMLElement, HTMLElement];
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: 'Tab' });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: 'Enter' });
    expect(onB).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a disabled item does nothing when chosen and the menu stays open', () => {
    const onSelect = vi.fn();
    const groups: MenuGroups = [{ id: 'g', items: [item('x', { disabled: true, disabledReason: 'Why', onSelect }) as never] }];
    render(h(MenuHarness, { groups }));
    fireEvent.click(screen.getByRole('menuitem'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('Escape closes and the focus goes back to the anchor; a click outside closes', () => {
    const groups: MenuGroups = [{ id: 'g', items: [item('a')] }];
    render(h(MenuHarness, { groups }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
    cleanup();
    render(h(MenuHarness, { groups }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('warns in development when the rule is broken (it still renders)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => item(x));
    render(h(MenuHarness, { groups: [{ id: 'g', items: many }] }));
    expect(err).toHaveBeenCalledWith(expect.stringContaining('8 items'));
    expect(screen.getAllByRole('menuitem')).toHaveLength(8);
    err.mockRestore();
  });
});

describe('Popover', () => {
  it('renders into the body only while open and names itself', () => {
    const Harness = ({ open }: { open: boolean }) => {
      const ref = useRef<HTMLButtonElement>(null);
      return h('div', null, h('button', { ref, type: 'button' }, 'Anchor'), h(Popover, { anchor: ref, open, onClose: () => {}, label: 'Activity' }, h('p', null, 'Body')));
    };
    const { rerender } = render(h(Harness, { open: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(h(Harness, { open: true }));
    expect(screen.getByRole('dialog', { name: 'Activity' }).parentElement).toBe(document.body);
  });
});

describe('Drawer', () => {
  it('is a modal dialog with a title; focus moves in, Escape closes, a click on the scrim closes, and the focus returns', () => {
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return h('div', null, h('button', { type: 'button', onClick: () => setOpen(true) }, 'Open'), h(Drawer, { open, onClose: () => setOpen(false), title: 'Claude' }, h('button', { type: 'button' }, 'Inside')));
    };
    render(h(Harness));
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    const dlg = screen.getByRole('dialog', { name: 'Claude' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.mouseDown(document.querySelector('.rl-drawer-scrim')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Tab wraps inside the drawer', () => {
    render(h(Drawer, { open: true, onClose: () => {}, title: 'Card' }, h('button', { type: 'button' }, 'Inside')));
    const dlg = screen.getByRole('dialog');
    const buttons = [...dlg.querySelectorAll<HTMLElement>('button')];
    const last = buttons[buttons.length - 1]!;
    last.focus();
    fireEvent.keyDown(dlg, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe('Banner and Toast', () => {
  it('an error banner is announced (alert), an info one is a status; the action and Close work', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(h(Banner, { tone: 'error', action: { label: 'Retry', onClick: onAction }, onClose }, 'Scan failed'));
    expect(screen.getByRole('alert').textContent).toContain('Scan failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    render(h(Banner, null, 'Heads up'));
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('a toast has an action (Undo) and the region is polite', () => {
    const onUndo = vi.fn();
    const { container } = render(h(ToastRegion, null, h(Toast, { tone: 'success', action: { label: 'Undo', onClick: onUndo } }, 'Moved 2 files')));
    expect(container.querySelector('.rl-toasts')?.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').className).toContain('rl-toast--success');
  });

  it('act() sanity: a toast error is announced as an alert', async () => {
    await act(async () => {
      render(h(Toast, { tone: 'error' }, 'Failed'));
    });
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
