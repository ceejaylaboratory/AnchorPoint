/**
 * Client-side preferences for the high-value biometric confirmation step.
 *
 * Kept outside the wallet/session stores so the opt-in survives wallet changes
 * and sign-outs; the storage key deliberately avoids the session-state terms
 * that `clearClientSessionState()` matches.
 */

export interface BiometricSettings {
  enabled: boolean;
  /** Transfers strictly greater than this amount require confirmation. */
  thresholdUsd: number;
}

export const BIOMETRIC_SETTINGS_STORAGE_KEY = 'anchorpoint.biometricConfirmation';

export const DEFAULT_BIOMETRIC_SETTINGS: BiometricSettings = {
  enabled: false,
  thresholdUsd: 1_000,
};

/** Coerce untrusted stored/user input into a usable positive threshold. */
export const sanitizeThreshold = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BIOMETRIC_SETTINGS.thresholdUsd;
};

export const loadBiometricSettings = (): BiometricSettings => {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_BIOMETRIC_SETTINGS };

  try {
    const raw = localStorage.getItem(BIOMETRIC_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BIOMETRIC_SETTINGS };

    const parsed = JSON.parse(raw) as Partial<BiometricSettings> | null;
    return {
      enabled: parsed?.enabled === true,
      thresholdUsd: sanitizeThreshold(parsed?.thresholdUsd),
    };
  } catch {
    // Private browsing or malformed data must never block a transfer.
    return { ...DEFAULT_BIOMETRIC_SETTINGS };
  }
};

export const saveBiometricSettings = (settings: BiometricSettings): void => {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(
      BIOMETRIC_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        enabled: settings.enabled === true,
        thresholdUsd: sanitizeThreshold(settings.thresholdUsd),
      }),
    );
  } catch {
    // Storage may be unavailable; the in-memory selection still applies.
  }
};

/** Pull the numeric amount out of a SEP-24 form's values by field name. */
export const getTransactionAmount = (values: Record<string, string>): number | null => {
  const entry = Object.entries(values).find(([key]) => key.toLowerCase().includes('amount'));
  if (!entry) return null;

  const amount = Number.parseFloat(entry[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

/** Whether a transfer needs an extra confirmation under the current settings. */
export const requiresBiometricConfirmation = (
  amount: string | number | null | undefined,
  settings: BiometricSettings = loadBiometricSettings(),
): boolean => {
  if (!settings.enabled) return false;

  const numeric = typeof amount === 'number' ? amount : Number.parseFloat(String(amount ?? ''));
  return Number.isFinite(numeric) && numeric > settings.thresholdUsd;
};
