import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * Selector matching every element that can receive keyboard focus. Used to
 * compute the focus trap boundaries each time Tab is pressed, so modals whose
 * contents change while open (async data, conditional fields) stay trapped.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface ModalProps {
  isOpen: boolean;
  /** Accessible name of the dialog, rendered as the heading unless hideTitle is set. */
  title: string;
  /** Optional supporting copy wired to aria-describedby. */
  description?: string;
  children?: ReactNode;
  /** Rendered in the button row at the bottom of the dialog. */
  footer?: ReactNode;
  /** Invoked on Escape, backdrop click, and the close button (unless `preventClose` is set). */
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg';
  /** Hide the visual heading while keeping the dialog's accessible name. */
  hideTitle?: boolean;
  /** Set to false for dialogs that must be dismissed via an explicit action. */
  closeOnBackdropClick?: boolean;
  /**
   * While true, Escape, backdrop clicks and the close button do not dismiss the
   * dialog (e.g. during an in-flight upload); `onCloseBlocked` is called instead
   * so the owner can ask the user to confirm.
   */
  preventClose?: boolean;
  /** Invoked instead of `onClose` when a close is attempted while `preventClose` is set. */
  onCloseBlocked?: () => void;
  /** Icon shown to the left of the title. */
  icon?: ReactNode;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
};

/**
 * Accessible modal dialog satisfying WCAG 2.1 AA:
 * - `role="dialog"` + `aria-modal="true"` with a programmatic accessible name.
 * - Focus moves into the dialog on open and is trapped there while open.
 * - Escape closes the dialog and focus returns to the triggering element.
 * - Background content is hidden from assistive tech via `aria-hidden`.
 */
export const Modal = ({
  isOpen,
  title,
  description,
  children,
  footer,
  onClose,
  size = 'md',
  hideTitle = false,
  closeOnBackdropClick = true,
  preventClose = false,
  onCloseBlocked,
  icon,
}: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const requestClose = useCallback(() => {
    if (preventClose) {
      onCloseBlocked?.();
      return;
    }
    onClose();
  }, [preventClose, onCloseBlocked, onClose]);

  const getFocusable = useCallback(() => {
    const root = dialogRef.current;
    if (!root) return [] as HTMLElement[];
    // Deliberately attribute-based rather than layout-based: `offsetParent` is
    // null for fixed-position subtrees and in non-rendering environments, which
    // would silently collapse the trap to a single element.
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) =>
        !element.hasAttribute('hidden') &&
        element.getAttribute('aria-hidden') !== 'true' &&
        !element.closest('[hidden],[aria-hidden="true"]'),
    );
  }, []);

  // Remember the trigger, move focus into the dialog, and restore focus on close.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    // Defer so the dialog is mounted and its children are laid out first.
    const frame = requestAnimationFrame(() => {
      const [first] = getFocusable();
      (first ?? dialogRef.current)?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, getFocusable]);

  // Escape to close, Tab/Shift+Tab wrap around inside the dialog.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing to cycle through — keep focus pinned to the dialog itself.
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, requestClose, getFocusable]);

  // Lock background scroll so the trapped dialog is the only scrollable surface.
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeOnBackdropClick ? requestClose : undefined}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            aria-hidden="true"
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className={`relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl focus:outline-none ${SIZE_CLASS[size]}`}
          >
            <button
              type="button"
              onClick={requestClose}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
              aria-label={`Close ${title}`}
            >
              <X size={18} aria-hidden="true" />
            </button>

            <div className="flex items-start gap-4 pr-8">
              {icon}
              <div className="space-y-1">
                <h2
                  id={titleId}
                  className={
                    hideTitle
                      ? 'absolute h-px w-px overflow-hidden whitespace-nowrap p-0 [clip:rect(0,0,0,0)]'
                      : 'font-display text-lg font-bold text-slate-100'
                  }
                >
                  {title}
                </h2>
                {description && (
                  <p id={descriptionId} className="text-sm leading-relaxed text-slate-400">
                    {description}
                  </p>
                )}
              </div>
            </div>

            {children && <div className="mt-5">{children}</div>}

            {footer && <div className="mt-6 flex flex-wrap justify-end gap-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default Modal;
