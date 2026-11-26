import { useEffect, useId, useState } from 'react';
import { Fingerprint, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { useTranslation } from '../i18n/config';
import { Modal } from './Modal';
import {
  WebAuthnCancelledError,
  isUserVerifyingAuthenticatorAvailable,
  requestBiometricVerification,
} from '../lib/webauthn';
import type { BiometricVerificationResult } from '../lib/webauthn';

export interface BiometricConfirmationProps {
  isOpen: boolean;
  /** Formatted transfer amount shown in the prompt. */
  amount: string;
  assetCode?: string;
  /** Called only after successful verification (or explicit fallback confirmation). */
  onConfirm: () => void;
  /** Called on cancel/dismiss; the caller must stop the transfer. */
  onCancel: () => void;
  /** Override for the WebAuthn ceremony (used in tests / alternate authenticators). */
  authenticate?: () => Promise<BiometricVerificationResult>;
}

type ConfirmationMode = 'biometric' | 'fallback';

/**
 * Blocks a high-value transfer until the user verifies locally with a platform
 * authenticator. Devices without one (or users who decline) get an explicit
 * password / PIN confirmation path instead of a dead end.
 */
export const BiometricConfirmation = ({
  isOpen,
  amount,
  assetCode,
  onConfirm,
  onCancel,
  authenticate,
}: BiometricConfirmationProps) => {
  const { t } = useTranslation();
  const fallbackInputId = useId();
  const [mode, setMode] = useState<ConfirmationMode>('biometric');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackCode, setFallbackCode] = useState('');

  // Every new prompt starts clean, and a device without a user-verifying
  // authenticator goes straight to the standard confirmation path.
  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    setMode('biometric');
    setVerifying(false);
    setError(null);
    setFallbackCode('');

    void isUserVerifyingAuthenticatorAvailable().then((available) => {
      if (!active) return;
      if (!available) {
        setMode('fallback');
        setError(t('biometric.unavailableNotice'));
      }
    });

    return () => {
      active = false;
    };
  }, [isOpen, t]);

  const verify = async () => {
    setVerifying(true);
    setError(null);
    try {
      await (authenticate ?? requestBiometricVerification)();
      setVerifying(false);
      // Confirm last: the parent closes this dialog, so no state updates should
      // follow the unmount.
      onConfirm();
    } catch (err) {
      setVerifying(false);
      setError(
        err instanceof WebAuthnCancelledError
          ? t('biometric.cancelledNotice')
          : t('biometric.failedNotice'),
      );
    }
  };

  const confirmWithFallback = () => {
    if (!fallbackCode.trim()) {
      setError(t('biometric.fallbackRequired'));
      return;
    }
    setError(null);
    onConfirm();
  };

  const isFallback = mode === 'fallback';

  return (
    <Modal
      isOpen={isOpen}
      title={t(isFallback ? 'biometric.fallbackTitle' : 'biometric.title')}
      description={t(isFallback ? 'biometric.fallbackDescription' : 'biometric.description')}
      onClose={onCancel}
      closeOnBackdropClick={false}
      size="sm"
      icon={
        isFallback ? (
          <KeyRound size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <Fingerprint size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        )
      }
    >
      <div className="space-y-4">
        <dl className="rounded-lg border border-slate-700/80 bg-slate-950/60 p-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-400">{t('biometric.amountLabel')}</dt>
            <dd data-testid="biometric-amount" className="font-medium text-slate-100">
              {assetCode ? `${amount} ${assetCode}` : amount}
            </dd>
          </div>
        </dl>

        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-amber-300">
            <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        {isFallback ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              confirmWithFallback();
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor={fallbackInputId} className="block text-sm font-medium text-slate-300">
                {t('biometric.fallbackLabel')}
              </label>
              <input
                id={fallbackInputId}
                data-testid="biometric-fallback-input"
                type="password"
                autoComplete="current-password"
                value={fallbackCode}
                onChange={(event) => setFallbackCode(event.target.value)}
                className="input-field w-full text-sm"
              />
            </div>
            <button type="submit" data-testid="biometric-fallback-confirm" className="btn-primary w-full">
              {t('biometric.confirmButton')}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              data-testid="biometric-verify-button"
              onClick={() => void verify()}
              disabled={verifying}
              className="btn-primary inline-flex w-full items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text disabled:opacity-60"
            >
              {verifying ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  {t('biometric.verifying')}
                </>
              ) : (
                <>
                  <Fingerprint size={16} aria-hidden="true" />
                  {t('biometric.verifyButton')}
                </>
              )}
            </button>
            <button
              type="button"
              data-testid="biometric-use-fallback"
              onClick={() => {
                setError(null);
                setMode('fallback');
              }}
              className="w-full rounded text-sm text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
            >
              {t('biometric.fallbackButton')}
            </button>
          </div>
        )}

        <button
          type="button"
          data-testid="biometric-cancel"
          onClick={onCancel}
          className="w-full rounded text-sm text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
        >
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  );
};

export default BiometricConfirmation;
