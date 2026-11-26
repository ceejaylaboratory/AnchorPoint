import { useSyncExternalStore } from 'react';

/**
 * Session auto-lock settings and the in-memory secret vault it wipes.
 *
 * The storage key deliberately avoids the words the sign-out sweep in App
 * matches (token/session/wallet/...), so a user's chosen timeout survives the
 * very lock it configures.
 */

export type AutoLockSetting = 5 | 15 | 30 | 'never';

export const AUTOLOCK_STORAGE_KEY = 'anchorpoint.autolockMinutes';
export const AUTOLOCK_CHANGE_EVENT = 'anchorpoint:autolock-change';
export const DEFAULT_AUTOLOCK: AutoLockSetting = 15;
/** The warning modal appears this long before the lock. */
export const AUTOLOCK_WARNING_MS = 60 * 1000;

export const AUTOLOCK_OPTIONS: { value: AutoLockSetting; label: string }[] = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 'never', label: 'Never' },
];

export function parseAutoLock(value: unknown): AutoLockSetting {
  if (value === 'never') return 'never';
  const minutes = Number(value);
  return minutes === 5 || minutes === 15 || minutes === 30 ? minutes : DEFAULT_AUTOLOCK;
}

export function readAutoLock(): AutoLockSetting {
  try {
    return parseAutoLock(localStorage.getItem(AUTOLOCK_STORAGE_KEY));
  } catch {
    return DEFAULT_AUTOLOCK;
  }
}

export function writeAutoLock(setting: AutoLockSetting): void {
  try {
    localStorage.setItem(AUTOLOCK_STORAGE_KEY, String(setting));
  } catch {
    // Best-effort; listeners still receive the in-memory change below.
  }
  window.dispatchEvent(new CustomEvent(AUTOLOCK_CHANGE_EVENT, { detail: setting }));
}

/** Milliseconds for a setting, or null for "Never". */
export function autoLockToMs(setting: AutoLockSetting): number | null {
  return setting === 'never' ? null : setting * 60 * 1000;
}

const subscribe = (onChange: () => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === AUTOLOCK_STORAGE_KEY) onChange();
  };
  window.addEventListener(AUTOLOCK_CHANGE_EVENT, onChange);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(AUTOLOCK_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', handleStorage);
  };
};

/** Live auto-lock setting, kept in sync across components and tabs. */
export function useAutoLockSetting(): [AutoLockSetting, (next: AutoLockSetting) => void] {
  const setting = useSyncExternalStore(subscribe, readAutoLock, () => DEFAULT_AUTOLOCK);
  return [setting, writeAutoLock];
}

// ── In-memory secret vault ──────────────────────────────────────────────────
//
// Decrypted key material (signing payload keys, unlocked session keys) must
// never be written to storage. Code that holds such material registers it
// here so the auto-lock can destroy it in one place.

type Secret = string | Uint8Array;

const vault = new Map<string, Secret>();
const wipeListeners = new Set<() => void>();

export function setSessionSecret(name: string, value: Secret): void {
  const previous = vault.get(name);
  if (previous instanceof Uint8Array && previous !== value) previous.fill(0);
  vault.set(name, value);
}

export function getSessionSecret(name: string): Secret | undefined {
  return vault.get(name);
}

export function hasSessionSecrets(): boolean {
  return vault.size > 0;
}

/** Lets holders of derived state (e.g. a cached CryptoKey) drop it on lock. */
export function onSessionSecretsWiped(listener: () => void): () => void {
  wipeListeners.add(listener);
  return () => wipeListeners.delete(listener);
}

/**
 * Zero-fills binary secrets and drops every entry. Strings are immutable in
 * JS and cannot be scrubbed, so they are only dereferenced.
 */
export function wipeSessionSecrets(): void {
  vault.forEach((value) => {
    if (value instanceof Uint8Array) value.fill(0);
  });
  vault.clear();
  wipeListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn('Session wipe listener failed:', error);
    }
  });
}
