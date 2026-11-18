import { useEffect, type KeyboardEvent, type RefObject } from 'react';

export const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [role="menuitem"]';

/**
 * Focus handling shared by Drawer and Menu: on mount the focus moves inside (the first focusable, else the container itself),
 * on unmount it returns to where it was (or to `returnTo`). The returned handler keeps Tab inside and closes on Escape.
 */
export function useFocusTrap(box: RefObject<HTMLElement | null>, onEscape: () => void, returnTo?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    (el?.querySelector<HTMLElement>(FOCUSABLE) ?? el)?.focus();
    return () => (returnTo?.current ?? before)?.focus?.();
  }, [box, returnTo]);

  return (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onEscape();
    } else if (e.key === 'Tab') {
      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return e.preventDefault();
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
}
