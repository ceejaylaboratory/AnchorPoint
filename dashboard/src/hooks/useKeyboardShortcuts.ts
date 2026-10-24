import { useEffect } from 'react';

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

export const DASHBOARD_SHORTCUTS: ShortcutDefinition[] = [
  { key: '?', description: 'Open keyboard shortcut help' },
  { key: 'N', description: 'Open new transaction flow' },
  { key: 'T', description: 'Go to transactions' },
  { key: 'S', description: 'Go to settings' },
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
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

export default useKeyboardShortcuts;
