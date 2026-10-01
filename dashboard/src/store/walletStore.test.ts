import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWalletStore, usePreferencesStore, DEFAULT_EXCLUDE_KEYS } from './walletStore';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] || null),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('walletStore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    useWalletStore.setState({
      publicKey: null,
      provider: null,
      isConnecting: false,
      error: null,
    });
  });

  it('should have initial state', () => {
    const state = useWalletStore.getState();
    expect(state.publicKey).toBeNull();
    expect(state.provider).toBeNull();
    expect(state.isConnecting).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should set connected state', () => {
    const { setConnected } = useWalletStore.getState();
    setConnected('GABC123...', 'freighter');
    
    const state = useWalletStore.getState();
    expect(state.publicKey).toBe('GABC123...');
    expect(state.provider).toBe('freighter');
    expect(state.isConnecting).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should set connecting state', () => {
    const { setConnecting } = useWalletStore.getState();
    setConnecting(true);
    
    expect(useWalletStore.getState().isConnecting).toBe(true);
  });

  it('should set error state', () => {
    const { setError } = useWalletStore.getState();
    setError('Connection failed');
    
    const state = useWalletStore.getState();
    expect(state.error).toBe('Connection failed');
    expect(state.isConnecting).toBe(false);
  });

  it('should disconnect and clear state', () => {
    // First connect
    useWalletStore.getState().setConnected('GABC123...', 'freighter');
    useWalletStore.getState().setError('some error');
    
    // Then disconnect
    useWalletStore.getState().disconnect();
    
    const state = useWalletStore.getState();
    expect(state.publicKey).toBeNull();
    expect(state.provider).toBeNull();
    expect(state.error).toBeNull();
  });

  it('should persist publicKey and provider to storage', () => {
    useWalletStore.getState().setConnected('GDEF456...', 'albedo');
    
    // Check that localStorage was called
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });
});

describe('preferencesStore', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    usePreferencesStore.setState({
      preferences: {
        theme: 'dark',
        language: 'en',
        sidebarCollapsed: false,
        defaultNetwork: 'testnet',
        recentAddresses: [],
        dashboardLayout: 'default',
      },
    });
  });

  it('should have default preferences', () => {
    const { preferences } = usePreferencesStore.getState();
    expect(preferences.theme).toBe('dark');
    expect(preferences.language).toBe('en');
    expect(preferences.sidebarCollapsed).toBe(false);
    expect(preferences.defaultNetwork).toBe('testnet');
    expect(preferences.dashboardLayout).toBe('default');
  });

  it('should update theme', () => {
    const { setTheme } = usePreferencesStore.getState();
    setTheme('light');
    
    expect(usePreferencesStore.getState().preferences.theme).toBe('light');
  });

  it('should update language', () => {
    const { setLanguage } = usePreferencesStore.getState();
    setLanguage('es');
    
    expect(usePreferencesStore.getState().preferences.language).toBe('es');
  });

  it('should toggle sidebar', () => {
    const { toggleSidebar } = usePreferencesStore.getState();
    
    expect(usePreferencesStore.getState().preferences.sidebarCollapsed).toBe(false);
    toggleSidebar();
    expect(usePreferencesStore.getState().preferences.sidebarCollapsed).toBe(true);
    toggleSidebar();
    expect(usePreferencesStore.getState().preferences.sidebarCollapsed).toBe(false);
  });

  it('should update default network', () => {
    const { setDefaultNetwork } = usePreferencesStore.getState();
    setDefaultNetwork('mainnet');
    
    expect(usePreferencesStore.getState().preferences.defaultNetwork).toBe('mainnet');
  });

  it('should add recent address', () => {
    const { addRecentAddress } = usePreferencesStore.getState();
    
    addRecentAddress('GAAA111...');
    expect(usePreferencesStore.getState().preferences.recentAddresses).toContain('GAAA111...');
  });

  it('should limit recent addresses to 10', () => {
    const { addRecentAddress } = usePreferencesStore.getState();
    
    // Add 12 addresses
    for (let i = 0; i < 12; i++) {
      addRecentAddress(`GADDR${i}...`);
    }
    
    const addresses = usePreferencesStore.getState().preferences.recentAddresses;
    expect(addresses.length).toBe(10);
    expect(addresses[0]).toBe('GADDR11...'); // Most recent first
  });

  it('should not duplicate recent addresses', () => {
    const { addRecentAddress } = usePreferencesStore.getState();
    
    addRecentAddress('GDupe1...');
    addRecentAddress('GDupe2...');
    addRecentAddress('GDupe1...'); // Duplicate
    
    const addresses = usePreferencesStore.getState().preferences.recentAddresses;
    expect(addresses.filter(a => a === 'GDupe1...').length).toBe(1);
    expect(addresses[0]).toBe('GDupe1...'); // Most recent first
  });

  it('should update dashboard layout', () => {
    const { setDashboardLayout } = usePreferencesStore.getState();
    setDashboardLayout('compact');
    
    expect(usePreferencesStore.getState().preferences.dashboardLayout).toBe('compact');
  });

  it('should reset preferences to defaults', () => {
    const { setTheme, setLanguage, resetPreferences } = usePreferencesStore.getState();
    
    setTheme('light');
    setLanguage('fr');
    resetPreferences();
    
    const { preferences } = usePreferencesStore.getState();
    expect(preferences.theme).toBe('dark');
    expect(preferences.language).toBe('en');
  });

  it('should persist preferences to storage', () => {
    usePreferencesStore.getState().setTheme('light');
    
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });
});

describe('DEFAULT_EXCLUDE_KEYS', () => {
  it('should be exported correctly', () => {
    expect(Array.isArray(DEFAULT_EXCLUDE_KEYS)).toBe(true);
    expect(DEFAULT_EXCLUDE_KEYS.length).toBeGreaterThan(0);
  });
});