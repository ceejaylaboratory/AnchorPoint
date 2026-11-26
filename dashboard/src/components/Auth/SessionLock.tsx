import React, { useEffect, useRef } from 'react';
import { Clock, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { Modal } from '../Modal';

export const formatCountdown = (ms: number | null): string => {
  const totalSeconds = Math.max(0, Math.ceil((ms ?? 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

interface InactivityWarningModalProps {
  isOpen: boolean;
  remainingMs: number | null;
  onStayLoggedIn: () => void;
  onLockNow: () => void;
}

/** Countdown shown during the final minute before the session auto-locks. */
export const InactivityWarningModal: React.FC<InactivityWarningModalProps> = ({
  isOpen,
  remainingMs,
  onStayLoggedIn,
  onLockNow,
}) => (
  <Modal
    isOpen={isOpen}
    title="Are you still there?"
    description="Your wallet session will lock soon because of inactivity."
    // Escape counts as "I'm here" — dismissing must never lock by surprise.
    onClose={onStayLoggedIn}
    closeOnBackdropClick={false}
    size="sm"
    icon={
      <div className="shrink-0 rounded-full bg-amber-500/10 p-3 text-amber-500">
        <Clock size={24} aria-hidden="true" />
      </div>
    }
    footer={
      <>
        <button
          type="button"
          onClick={onLockNow}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
        >
          <LogOut size={16} aria-hidden="true" />
          Lock now
        </button>
        <button
          type="button"
          onClick={onStayLoggedIn}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
        >
          <ShieldCheck size={16} aria-hidden="true" />
          Stay Logged In
        </button>
      </>
    }
  >
    <p className="text-sm text-slate-300">
      Locking in{' '}
      <span
        data-testid="inactivity-countdown"
        className="font-mono text-lg font-semibold text-amber-400"
        // Announcing every tick would be noise; the dialog itself is announced on open.
        aria-live="off"
      >
        {formatCountdown(remainingMs)}
      </span>
    </p>
    <p className="mt-2 text-xs text-slate-400">
      On lock, decrypted session keys are cleared from memory and your wallet is disconnected.
    </p>
  </Modal>
);

interface SessionLockedOverlayProps {
  isLocked: boolean;
  onUnlock: () => void;
  /** Label of the view the user will return to after unlocking. */
  resumeLabel?: string;
}

/**
 * Full-screen cover shown after an inactivity lock. It sits below the modal
 * layer (z-50) so the wallet picker opened by "Unlock" appears on top.
 */
export const SessionLockedOverlay: React.FC<SessionLockedOverlayProps> = ({
  isLocked,
  onUnlock,
  resumeLabel,
}) => {
  const unlockRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isLocked) unlockRef.current?.focus();
  }, [isLocked]);

  if (!isLocked) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-locked-title"
      aria-describedby="session-locked-description"
      data-testid="session-locked-overlay"
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 p-4 backdrop-blur-xl"
    >
      <div className="glass-card w-full max-w-sm p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary-text">
          <Lock size={28} aria-hidden="true" />
        </div>
        <h2 id="session-locked-title" className="font-display text-xl font-bold text-slate-100">
          Session locked
        </h2>
        <p id="session-locked-description" className="mt-2 text-sm text-slate-400">
          We locked your session after a period of inactivity and disconnected your wallet.
          {resumeLabel ? ` Reconnect to continue where you left off (${resumeLabel}).` : ' Reconnect to continue.'}
        </p>
        <button
          ref={unlockRef}
          type="button"
          onClick={onUnlock}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
        >
          Reconnect wallet
        </button>
      </div>
    </div>
  );
};
