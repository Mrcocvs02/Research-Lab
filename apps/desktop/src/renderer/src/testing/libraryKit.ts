import { fireEvent, screen } from '@testing-library/react';
import { createElement, Fragment, type ReactElement } from 'react';
import { setSearchText } from '../lib/librarySearch';
import { HistoryButtons } from '../shell/HistoryButtons';
import { TopSearch } from '../shell/TopSearch';

/** What the top bar holds for the Library tests: the search box (with the syntax and Claude buttons) and Undo / History. */
export const topBarParts = (): ReactElement => createElement(Fragment, null, createElement(TopSearch), createElement(HistoryButtons));

/** The search text is global (`lib/librarySearch`): every test starts from an empty box. */
export const resetSearch = () => setSearchText('');

/** Opens the "View" popover (list, grid and sort order) when it is not open. */
export function openViewMenu() {
  if (!screen.queryByTestId('view-grid')) fireEvent.click(screen.getByTestId('view-menu'));
}

export function pickView(mode: 'list' | 'grid') {
  openViewMenu();
  fireEvent.click(screen.getByTestId(`view-${mode}`));
}

export function pickSort(value: string) {
  openViewMenu();
  fireEvent.change(screen.getByTestId('search-sort'), { target: { value } });
}

/** Opens the card (the details panel) when it is closed. */
export function openDetail() {
  if (!screen.queryByTestId('detail-pane')) fireEvent.click(screen.getByTestId('detail-toggle'));
}

/** A menu entry by its name, in the menu that is open (menus are portalled to the body). */
export function chooseMenuItem(name: string | RegExp) {
  fireEvent.click(screen.getByRole('menuitem', { name, hidden: true }));
}

export function openLibraryMenu(item: string | RegExp) {
  fireEvent.click(screen.getByTestId('library-more'));
  chooseMenuItem(item);
}

export function openTaxonomy() {
  openLibraryMenu(/Manage tags/);
}

/** Opens the popover of a filter chip ("tags", "years", ...). */
export function openFacet(id: string) {
  const chip = screen.getByTestId(`facet-chip-${id}`);
  fireEvent.click(chip.querySelector('button.rl-chip__main')!);
}
