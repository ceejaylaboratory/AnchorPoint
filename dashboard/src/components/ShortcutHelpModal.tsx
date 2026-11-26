import React from 'react';
import { DASHBOARD_SHORTCUTS } from '../hooks/useKeyboardShortcuts';
import { Modal } from './Modal';

export interface ShortcutHelpModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Help modal documenting the dashboard keyboard shortcuts.
 * Opened with `?`; closed with Escape or the close button.
 *
 * Uses the shared {@link Modal} base component so it inherits the WCAG 2.1 AA
 * focus trap, Escape handling, `role="dialog"` / `aria-modal="true"`, and
 * focus-restore behaviour without duplicating them.
 */
export const ShortcutHelpModal: React.FC<ShortcutHelpModalProps> = ({ open, onClose }) => (
  <Modal isOpen={open} title="Keyboard Shortcuts" onClose={onClose} size="sm">
    <ul className="space-y-2" aria-label="Available keyboard shortcuts">
      {DASHBOARD_SHORTCUTS.map((shortcut) => (
        <li
          key={shortcut.key}
          className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-2.5 text-sm"
        >
          <span className="text-slate-300">{shortcut.description}</span>
          <kbd className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-xs font-bold text-slate-100">
            {shortcut.key}
          </kbd>
        </li>
      ))}
    </ul>
    <p className="mt-3 text-xs text-slate-500">
      Shortcuts are disabled while typing in inputs or text areas.
    </p>
  </Modal>
);

export default ShortcutHelpModal;
