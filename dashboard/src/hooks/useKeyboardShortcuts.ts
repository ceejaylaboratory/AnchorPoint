import { useEffect, useRef, type RefObject } from 'react';

export interface KeyboardShortcutActions {
  /** Open the keyboard shortcut help modal (`?`). */
  onOpenHelp: () => void;
  /** Start the new-transaction flow (`N`). */
  onNewTransaction: () => void;
  /** Navigate to transactions (`T`). */
  onNavigateTransactions: () => void;
  /** Navigate to settings (`S`). */
  onNavigateSettings: () => void;
}

export interface ShortcutDefinition {
  key: string;
  description: string;
}

/** Shortcuts that apply when an interactive table row is focused. */
export const TABLE_SHORTCUTS: ShortcutDefinition[] = [
  { key: '↑ / ↓', description: 'Move to the previous / next table row' },
  { key: 'C', description: 'Copy the selected row value' },
  { key: 'Enter', description: 'View details for the selected row' },
];

export const DASHBOARD_SHORTCUTS: ShortcutDefinition[] = [
  { key: '?', description: 'Open keyboard shortcut help' },
  { key: 'N', description: 'Open new transaction flow' },
  { key: 'T', description: 'Go to transactions' },
  { key: 'S', description: 'Go to settings' },
  ...TABLE_SHORTCUTS,
];

function isHTMLElement(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!isHTMLElement(target)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

/** Buttons and links own Enter/Space/arrow semantics; do not hijack them. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, a, [role="button"], input, select, textarea'));
}

/**
 * Global keyboard shortcuts for common dashboard actions.
 * Ignored while focus is inside an input, textarea, select, or contentEditable element.
 * `?` (Shift+/) opens the help modal; `N` / `T` / `S` trigger navigation actions.
 */
export function useKeyboardShortcuts(actions: KeyboardShortcutActions): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key) {
        case '?':
          event.preventDefault();
          actions.onOpenHelp();
          break;
        case 'n':
        case 'N':
          event.preventDefault();
          actions.onNewTransaction();
          break;
        case 't':
        case 'T':
          event.preventDefault();
          actions.onNavigateTransactions();
          break;
        case 's':
        case 'S':
          event.preventDefault();
          actions.onNavigateSettings();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions.onOpenHelp, actions.onNewTransaction, actions.onNavigateTransactions, actions.onNavigateSettings]);
}

export interface TableKeyboardNavigationOptions {
  /** The element containing rows marked with `data-keyboard-row`. */
  containerRef: RefObject<HTMLElement | null>;
  /** Number of selectable rows (usually the filtered data length). */
  rowCount: number;
  /** Currently selected row index. */
  selectedIndex: number;
  /** Called when ArrowUp / ArrowDown selects a different row. */
  onSelectRow: (index: number) => void;
  /** Called for `C`; use this to trigger the row's copy affordance. */
  onCopyRow?: (index: number) => void;
  /** Called for `Enter`; use this to open the selected row's details. */
  onOpenRow?: (index: number) => void;
  /** Allows temporarily disabling navigation (e.g. while a modal is open). */
  enabled?: boolean;
}

/**
 * Roving-focus row navigation for interactive tables and table-like lists.
 *
 * Rows must carry `data-keyboard-row`; the hook focuses the newly selected row
 * so subsequent arrow presses continue from there. Navigation is scoped to the
 * supplied container, so multiple tables can coexist on one page.
 */
export function useTableRowKeyboardNavigation({
  containerRef,
  rowCount,
  selectedIndex,
  onSelectRow,
  onCopyRow,
  onOpenRow,
  enabled = true,
}: TableKeyboardNavigationOptions): void {
  const selectedIndexRef = useRef(selectedIndex);
  const callbacksRef = useRef({ onSelectRow, onCopyRow, onOpenRow });

  // Keep the listener stable while always using the latest state/callbacks.
  selectedIndexRef.current = selectedIndex;
  callbacksRef.current = { onSelectRow, onCopyRow, onOpenRow };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled || rowCount === 0) return undefined;

    const getRows = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-keyboard-row]'));

    const focusRow = (index: number) => {
      const row = getRows()[index];
      if (!row) return;
      row.focus();
      row.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    };

    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !container.contains(target)) return;
      if (isEditableTarget(target) || isInteractiveTarget(target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const rows = getRows();
      if (rows.length === 0) return;

      const current = selectedIndexRef.current;
      const { onSelectRow: select, onCopyRow: copy, onOpenRow: open } = callbacksRef.current;

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          const next = current < 0 ? 0 : (current + 1) % rows.length;
          select(next);
          focusRow(next);
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          const next = current <= 0 ? rows.length - 1 : current - 1;
          select(next);
          focusRow(next);
          break;
        }
        case 'c':
        case 'C':
          if (copy) {
            event.preventDefault();
            copy(current < 0 ? 0 : current);
          }
          break;
        case 'Enter':
          if (open) {
            event.preventDefault();
            open(current < 0 ? 0 : current);
          }
          break;
        default:
          break;
      }
    };

    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  }, [containerRef, enabled, rowCount]);
}

export default useKeyboardShortcuts;
