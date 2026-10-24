import React from 'react';
import { X } from 'lucide-react';
import { DASHBOARD_SHORTCUTS } from '../hooks/useKeyboardShortcuts';

export interface ShortcutHelpModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Help modal documenting the dashboard keyboard shortcuts.
 * Opened with `?`; closed with Escape or the close button.
 */
export const ShortcutHelpModal: React.FC<ShortcutHelpModalProps> = ({ open, onClose }) => {
  React.useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id="shortcut-help-title" className="text-lg font-bold text-slate-100">
            Keyboard Shortcuts
          </h3>
          <button
            type="button"
            aria-label="Close shortcuts help"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <ul className="mt-4 space-y-2">
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
      </div>
    </div>
  );
};

export default ShortcutHelpModal;
