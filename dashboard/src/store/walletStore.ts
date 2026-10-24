import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSecureStorage, DEFAULT_EXCLUDE_KEYS } from './storage';

export type WalletProviderId = 'freighter' | 'albedo' | 'rabet';

/**
 * Wallet connection state
 */
type WalletState = {
  publicKey: string | null;
  provider: WalletProviderId | null;
  isConnecting: boolean;
  error: string | null;
  setConnected: (publicKey: string, provider: WalletProviderId) => void;
  setConnecting: (isConnecting: boolean) => void;
  setError: (error: string | null) => void;
  disconnect: () => void;
};

/**
 * User preferences for the dashboard
 * These are persisted in encrypted localStorage
 */
export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'es' | 'pt' | 'fr';
  sidebarCollapsed: boolean;
  defaultNetwork: 'testnet' | 'mainnet' | 'futurenet';
  recentAddresses: string[];
  dashboardLayout: string;
}

type PreferencesState = {
  preferences: UserPreferences;
  setTheme: (theme: UserPreferences['theme']) => void;
  setLanguage: (language: UserPreferences['language']) => void;
  toggleSidebar: () => void;
  setDefaultNetwork: (network: UserPreferences['defaultNetwork']) => void;
  addRecentAddress: (address: string) => void;
  setDashboardLayout: (layout: string) => void;
  resetPreferences: () => void;
};

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  language: 'en',
  sidebarCollapsed: false,
  defaultNetwork: 'testnet',
  recentAddresses: [],
  dashboardLayout: 'default',
};

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      publicKey: null,
      provider: null,
      isConnecting: false,
      error: null,
      setConnected: (publicKey, provider) => set({ publicKey, provider, isConnecting: false, error: null }),
      setConnecting: (isConnecting) => set({ isConnecting }),
      setError: (error) => set({ error, isConnecting: false }),
      disconnect: () => set({ publicKey: null, provider: null, error: null }),
    }),
    {
      name: 'wallet-storage',
      storage: createJSONStorage(() => createSecureStorage('wallet')),
      // Explicitly exclude auth tokens - they should be handled in memory, not persisted
      partialize: (state) => ({
        publicKey: state.publicKey,
        provider: state.provider,
      }),
    }
  )
);

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      preferences: DEFAULT_PREFERENCES,

      setTheme: (theme) =>
        set((state) => ({
          preferences: { ...state.preferences, theme },
        })),

      setLanguage: (language) =>
        set((state) => ({
          preferences: { ...state.preferences, language },
        })),

      toggleSidebar: () =>
        set((state) => ({
          preferences: { ...state.preferences, sidebarCollapsed: !state.preferences.sidebarCollapsed },
        })),

      setDefaultNetwork: (defaultNetwork) =>
        set((state) => ({
          preferences: { ...state.preferences, defaultNetwork },
        })),

      addRecentAddress: (address: string) =>
        set((state) => {
          const current = state.preferences.recentAddresses;
          const filtered = current.filter((a) => a !== address);
          const updated = [address, ...filtered].slice(0, 10); // Keep max 10 recent
          return {
            preferences: { ...state.preferences, recentAddresses: updated },
          };
        }),

      setDashboardLayout: (dashboardLayout) =>
        set((state) => ({
          preferences: { ...state.preferences, dashboardLayout },
        })),

      resetPreferences: () =>
        set(() => ({
          preferences: DEFAULT_PREFERENCES,
        })),
    }),
    {
      name: 'preferences-storage',
      storage: createJSONStorage(() => createSecureStorage('preferences')),
    }
  )
);

// ── Notification Preferences Store (#1491) ─────────────────────────────────────
//
// Persists notification channel settings. Transient UI state (loading, saving,
// error) is intentionally excluded from persistence via `partialize`.

export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  phone: string;
}

type NotificationPrefsState = {
  /** Persisted notification channel preferences. */
  notificationPrefs: NotificationPreferences;
  /** Transient: whether preferences are being fetched from the server. */
  isLoading: boolean;
  /** Transient: whether a save is in flight. */
  isSaving: boolean;
  /** Transient: last error message, if any. */
  saveError: string | null;

  setEmailEnabled: (enabled: boolean) => void;
  setSmsEnabled: (enabled: boolean) => void;
  setPushEnabled: (enabled: boolean) => void;
  setPhone: (phone: string) => void;
  setNotificationPrefs: (prefs: Partial<NotificationPreferences>) => void;
  resetNotificationPrefs: () => void;

  // Transient state setters (not persisted)
  setIsLoading: (loading: boolean) => void;
  setIsSaving: (saving: boolean) => void;
  setSaveError: (error: string | null) => void;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  emailEnabled: true,
  smsEnabled: false,
  pushEnabled: false,
  phone: '',
};

export const useNotificationPrefsStore = create<NotificationPrefsState>()(
  persist(
    (set) => ({
      notificationPrefs: DEFAULT_NOTIFICATION_PREFERENCES,

      // Transient state — reset to safe defaults on hydration
      isLoading: false,
      isSaving: false,
      saveError: null,

      setEmailEnabled: (emailEnabled) =>
        set((state) => ({
          notificationPrefs: { ...state.notificationPrefs, emailEnabled },
        })),

      setSmsEnabled: (smsEnabled) =>
        set((state) => ({
          notificationPrefs: { ...state.notificationPrefs, smsEnabled },
        })),

      setPushEnabled: (pushEnabled) =>
        set((state) => ({
          notificationPrefs: { ...state.notificationPrefs, pushEnabled },
        })),

      setPhone: (phone) =>
        set((state) => ({
          notificationPrefs: { ...state.notificationPrefs, phone },
        })),

      setNotificationPrefs: (prefs) =>
        set((state) => ({
          notificationPrefs: { ...state.notificationPrefs, ...prefs },
        })),

      resetNotificationPrefs: () =>
        set(() => ({
          notificationPrefs: DEFAULT_NOTIFICATION_PREFERENCES,
        })),

      setIsLoading: (isLoading) => set({ isLoading }),
      setIsSaving: (isSaving) => set({ isSaving }),
      setSaveError: (saveError) => set({ saveError }),
    }),
    {
      name: 'notification-prefs-storage',
      storage: createJSONStorage(() => createSecureStorage('notification-prefs')),
      // Persist only the notification channel preferences; exclude all
      // transient UI state so it never leaks into localStorage.
      partialize: (state) => ({
        notificationPrefs: state.notificationPrefs,
      }),
    }
  )
);

// Re-export DEFAULT_EXCLUDE_KEYS for testing
export { DEFAULT_EXCLUDE_KEYS };