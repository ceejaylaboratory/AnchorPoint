import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BIOMETRIC_SETTINGS_STORAGE_KEY,
  DEFAULT_BIOMETRIC_SETTINGS,
  getTransactionAmount,
  loadBiometricSettings,
  requiresBiometricConfirmation,
  sanitizeThreshold,
  saveBiometricSettings,
} from './biometricSettings';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('biometric settings persistence', () => {
  it('defaults to opt-out with a $1,000 threshold', () => {
    expect(loadBiometricSettings()).toEqual(DEFAULT_BIOMETRIC_SETTINGS);
    expect(DEFAULT_BIOMETRIC_SETTINGS).toEqual({ enabled: false, thresholdUsd: 1_000 });
  });

  it('round-trips an opted-in setting with a custom threshold', () => {
    saveBiometricSettings({ enabled: true, thresholdUsd: 2_500 });

    expect(loadBiometricSettings()).toEqual({ enabled: true, thresholdUsd: 2_500 });
    expect(localStorage.getItem(BIOMETRIC_SETTINGS_STORAGE_KEY)).toContain('2500');
  });

  it('falls back to defaults for malformed stored data', () => {
    localStorage.setItem(BIOMETRIC_SETTINGS_STORAGE_KEY, '{not json');
    expect(loadBiometricSettings()).toEqual(DEFAULT_BIOMETRIC_SETTINGS);

    localStorage.setItem(BIOMETRIC_SETTINGS_STORAGE_KEY, JSON.stringify({ enabled: 'yes', thresholdUsd: -5 }));
    expect(loadBiometricSettings()).toEqual(DEFAULT_BIOMETRIC_SETTINGS);
  });

  it('sanitizes invalid thresholds', () => {
    expect(sanitizeThreshold('100')).toBe(100);
    expect(sanitizeThreshold('')).toBe(DEFAULT_BIOMETRIC_SETTINGS.thresholdUsd);
    expect(sanitizeThreshold('abc')).toBe(DEFAULT_BIOMETRIC_SETTINGS.thresholdUsd);
    expect(sanitizeThreshold(0)).toBe(DEFAULT_BIOMETRIC_SETTINGS.thresholdUsd);
  });
});

describe('high-value detection', () => {
  it('extracts the amount field from a SEP-24 form payload', () => {
    expect(getTransactionAmount({ walletAddress: 'GABC', depositAmount: '1250.50' })).toBe(1250.5);
    expect(getTransactionAmount({ walletAddress: 'GABC' })).toBeNull();
    expect(getTransactionAmount({ amount: 'not-a-number' })).toBeNull();
  });

  it('only requires confirmation above the configured threshold when enabled', () => {
    const settings = { enabled: true, thresholdUsd: 1_000 };

    expect(requiresBiometricConfirmation('1000', settings)).toBe(false);
    expect(requiresBiometricConfirmation('1000.01', settings)).toBe(true);
    expect(requiresBiometricConfirmation(5_000, settings)).toBe(true);
    expect(requiresBiometricConfirmation(null, settings)).toBe(false);
  });

  it('never requires confirmation while the opt-in is off', () => {
    expect(requiresBiometricConfirmation('50000', { enabled: false, thresholdUsd: 1_000 })).toBe(false);
  });

  it('reads the persisted setting by default', () => {
    saveBiometricSettings({ enabled: true, thresholdUsd: 100 });
    expect(requiresBiometricConfirmation('250')).toBe(true);
  });
});
