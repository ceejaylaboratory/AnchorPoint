import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard,
  ArrowUpRight,
  ArrowDownLeft,
  History,
  Settings,
  ShieldCheck,
  Menu,
  X,
  Wallet,
  AlertCircle,
  Bell,
  RefreshCcw,
  Activity,
  Sun,
  Moon,
  TerminalSquare,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { UiConfig } from './types';
import { Sidebar } from './components/Sidebar';
import { NotificationBell } from './components/NotificationBell';
import { StatusBanner } from './components/StatusBanner';
import { UserAvatarDropdown } from './components/UserAvatarDropdown';
import { CopyablePublicKey } from './components/CopyablePublicKey';
import { WalletModal } from './components/WalletModal';
import { NetworkSelector, NetworkBanner } from './components/NetworkSelector';
import { NetworkProvider } from './contexts/NetworkContext';
import { SessionTimeoutModal } from './components/Auth/SessionTimeoutModal';
import { WalletManager } from './lib/wallet';
import { I18nProvider, useTranslation } from './i18n/config';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

export { useTheme };

const DashboardOverview = lazy(() => import('./components/DashboardOverview'));
const TransactionHistory = lazy(() => import('./components/TransactionHistory'));
const SEP24Flow = lazy(() => import('./components/SEP24Flow'));
const KycStatusView = lazy(() => import('./components/KycStatusView'));
const NotificationCenter = lazy(() => import('./components/NotificationCenter'));
const NotificationPreferences = lazy(() => import('./components/NotificationPreferences'));
const Sep38QuotePanel = lazy(() => import('./components/Sep38QuotePanel'));
const ServiceStatusPanel = lazy(() => import('./components/ServiceStatusPanel'));
const SettingsView = lazy(() => import('./components/SettingsView'));
const ContractPlayground = lazy(() => import('./components/ContractPlayground'));

const defaultUiConfig: UiConfig = {
  brandName: 'AnchorPoint',
  primaryColor: '#3b82f6',
  accentColor: '#14b8a6',
  supportEmail: 'support@anchorpoint.local',
  fieldRequirements: {
    deposit: [
      { key: 'walletAddress', label: 'Wallet Address', required: true, placeholder: 'G...' },
      { key: 'amount', label: 'Amount', required: true, placeholder: '500.00' },
    ],
    withdraw: [
      { key: 'iban', label: 'IBAN', required: true, placeholder: 'DE89370400440532013000' },
      { key: 'bankAccount', label: 'Bank Account', required: true, placeholder: 'Account number' },
      { key: 'beneficiaryAddress', label: 'Beneficiary Address', required: true, placeholder: 'Street, city, postal code' },
      { key: 'amount', label: 'Amount', required: true, placeholder: '120.50' },
    ],
    kyc: [
      { key: 'firstName', label: 'First Name', required: true },
      { key: 'lastName', label: 'Last Name', required: true },
      { key: 'country', label: 'Country', required: true },
      {
        key: 'id_photo_front',
        label: 'Government ID (Front)',
        required: true,
        type: 'file',
        accept: 'image/jpeg,image/png,application/pdf',
        helpText: 'Clear photo of the front of your government-issued ID.',
      },
      {
        key: 'proof_of_address',
        label: 'Proof of Address',
        required: true,
        type: 'file',
        accept: 'image/jpeg,image/png,application/pdf',
        helpText: 'Utility bill or bank statement dated within the last 90 days.',
      },
    ],
  },
};

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3002';
const darkSurface = '#020617';
const lightText = '#ffffff';
const fallbackPrimaryText = '#93c5fd';
const fallbackAccentText = '#5eead4';

const hexToRgb = (hexColor: string): [number, number, number] | null => {
  const normalized = hexColor.replace('#', '').trim();
  const hex =
    normalized.length === 3 ? normalized.split('').map((char) => `${char}${char}`).join('') : normalized;

  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return null;
  }

  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
};

const relativeLuminance = (hexColor: string): number => {
  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    return 0;
  }

  const [red, green, blue] = rgb.map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
};

const getAccessibleTextColor = (brandColor: string, fallbackColor: string) =>
  contrastRatio(brandColor, darkSurface) >= 4.5 ? brandColor : fallbackColor;

const getAccessibleForeground = (backgroundColor: string) =>
  contrastRatio(lightText, backgroundColor) >= 4.5 ? lightText : darkSurface;

const TabFallback = () => (
  <div className="flex h-48 items-center justify-center" role="status" aria-label="Loading content">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-500 border-t-primary-text" />
  </div>
);

const App = () => {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  return (
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  );
};

const AppShell = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [uiConfig, setUiConfig] = useState<UiConfig>(defaultUiConfig);
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [wallet, setWallet] = useState<{ publicKey: string; network: string } | null>(null);
  const [walletStatus, setWalletStatus] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [walletError, setWalletError] = useState('');
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletSessionResetCounter, setWalletSessionResetCounter] = useState(0);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const walletManager = useMemo(() => WalletManager.getInstance(), []);
  const { t, language, changeLanguage } = useTranslation();

  const clearClientSessionState = useCallback(() => {
    const shouldClearKey = (key: string) => /token|session|wallet|transaction|balance/i.test(key);

    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && shouldClearKey(key)) {
        localStorage.removeItem(key);
      }
    }

    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key && shouldClearKey(key)) {
        sessionStorage.removeItem(key);
      }
    }
  }, []);

  const handleWalletDisconnect = useCallback(async (skipAdapterDisconnect = false) => {
    if (!skipAdapterDisconnect && selectedWalletId) {
      try {
        await walletManager.disconnectWallet(selectedWalletId);
      } catch (error) {
        console.warn('Wallet disconnect cleanup failed:', error);
      }
    }

    clearClientSessionState();
    setWallet(null);
    setWalletStatus('idle');
    setWalletError('');
    setSelectedWalletId(null);
    setActiveTab('dashboard');
    setWalletSessionResetCounter((previous) => previous + 1);
  }, [clearClientSessionState, walletManager, selectedWalletId]);

  useEffect(() => {
    let ignore = false;

    const loadUiConfig = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/config/ui`);
        if (!response.ok) {
          throw new Error(`Failed to load UI config: ${response.status}`);
        }

        const payload = await response.json();
        if (!ignore) {
          if (payload?.data) {
            setUiConfig(payload.data as UiConfig);
          }
          setLoadingState('ready');
        }
      } catch (error) {
        console.error(error);
        if (!ignore) {
          setLoadingState('error');
        }
      }
    };

    void loadUiConfig();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const handleExternalDisconnect = () => {
      if (selectedWalletId === 'freighter') {
        void handleWalletDisconnect(true);
      }
    };

    window.addEventListener('freighter:disconnect', handleExternalDisconnect);
    return () => {
      window.removeEventListener('freighter:disconnect', handleExternalDisconnect);
    };
  }, [handleWalletDisconnect, selectedWalletId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
      setSidebarOpen(event.matches);
    };

    setIsDesktop(mediaQuery.matches);
    setSidebarOpen(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  // Lock body scroll while the mobile drawer is open so the drawer is the only
  // scrollable surface. Desktop keeps the sidebar docked, so it never locks.
  useEffect(() => {
    if (isDesktop || !sidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isDesktop, sidebarOpen]);

  useEffect(() => {
    // Load saved wallet preference
    const savedWalletId = localStorage.getItem('preferredWalletId');
    if (savedWalletId) {
      setSelectedWalletId(savedWalletId);
    }
  }, []);

  const menuItems = useMemo(
    () => [
      { id: 'dashboard', icon: LayoutDashboard, label: t('nav.overview') },
      { id: 'deposit', icon: ArrowDownLeft, label: t('nav.deposit') },
      { id: 'withdraw', icon: ArrowUpRight, label: t('nav.withdraw') },
      { id: 'history', icon: History, label: t('nav.history') },
      { id: 'sep38', icon: RefreshCcw, label: t('nav.sep38') },
      { id: 'status', icon: Activity, label: t('nav.status') },
      { id: 'notifications', icon: Bell, label: t('nav.notifications') },
      { id: 'contract-playground', icon: TerminalSquare, label: 'Contract Playground' },
      { id: 'kyc', icon: ShieldCheck, label: t('nav.kyc') },
      { id: 'settings', icon: Settings, label: t('nav.settings') },
    ],
    [t],
  );

  const handleConnectWallet = async (walletId: string) => {
    setWalletStatus('connecting');
    setWalletError('');

    try {
      const connectedWallet = await walletManager.connectWallet(walletId);
      setWallet(connectedWallet);
      setSelectedWalletId(walletId);
      setWalletStatus('idle');
      
      // Save wallet preference to localStorage
      localStorage.setItem('preferredWalletId', walletId);
    } catch (error) {
      setWalletStatus('error');
      setWalletError(error instanceof Error ? error.message : 'Unable to connect wallet.');
    }
  };

  const handleWalletOptionSelect = async (walletId: string) => {
    setWalletModalOpen(false);
    await handleConnectWallet(walletId);
  };

  return (
    <div
      className="min-h-screen flex"
      style={
        {
          ['--primary' as string]: uiConfig.primaryColor,
          ['--primary-foreground' as string]: getAccessibleForeground(uiConfig.primaryColor),
          ['--primary-text' as string]: getAccessibleTextColor(uiConfig.primaryColor, fallbackPrimaryText),
          ['--accent' as string]: uiConfig.accentColor,
          ['--accent-text' as string]: getAccessibleTextColor(uiConfig.accentColor, fallbackAccentText),
        } as React.CSSProperties
      }
    >
      <Sidebar
        activeTab={activeTab}
        loadingState={loadingState}
        menuItems={menuItems}
        sidebarOpen={sidebarOpen}
        uiConfig={uiConfig}
        onClose={() => setSidebarOpen(false)}
        onSelect={(tabId) => setActiveTab(tabId)}
      />

      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onSelect={handleWalletOptionSelect}
      >
        <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs text-slate-400">
          <span>Multiple wallet options available</span>
          <span>{walletStatus === 'connecting' ? 'Connecting…' : 'Select a provider to continue'}</span>
        </div>
      </WalletModal>

      <SessionTimeoutModal />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 bg-background/80 px-3 py-3 backdrop-blur-md sm:px-6 lg:px-8">
          <button
            aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={sidebarOpen}
            aria-controls="main-sidebar"
            className="relative z-20 -ml-2 rounded bg-background p-2 md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-4">
            <div
              data-testid="backend-status"
              className="hidden items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 md:flex"
              role="status"
              aria-live="polite"
              aria-label={
                loadingState === 'error'
                  ? 'Fallback theme active: backend config unavailable'
                  : 'Backend configuration connected'
              }
            >
              <div
                className={`h-2 w-2 rounded-full ${
                  loadingState === 'error' ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'
                }`}
                aria-hidden="true"
              />
              <span className="text-xs font-semibold text-slate-300">
                {loadingState === 'error' ? 'Fallback Theme Active' : 'Config Connected'}
              </span>
            </div>
            <NotificationBell
              apiBaseUrl={apiBaseUrl}
              onViewAll={() => setActiveTab('notifications')}
            />
            <ThemeToggle />
            <div className="flex min-w-0 items-center gap-2">
              {wallet ? (
                <div className="flex items-center gap-2">
                  <CopyablePublicKey publicKey={wallet.publicKey} label={`${wallet.network} public key`} />
                  <span className="hidden rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 md:inline">
                    0.00 XLM
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setWalletModalOpen(true)}
                  disabled={walletStatus === 'connecting'}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:px-4"
                >
                  <Wallet size={18} aria-hidden="true" />
                  <span className="hidden text-sm font-medium sm:inline">
                    {walletStatus === 'connecting' ? t('wallet.connecting') : t('wallet.connect')}
                  </span>
                </button>
              )}
              {walletStatus === 'error' && !wallet ? (
                <span className="hidden max-w-48 truncate text-xs text-rose-300 md:inline" role="alert">
                  {walletError}
                </span>
              ) : null}
            </div>
              <select
                aria-label={t('language.label')}
                value={language}
                onChange={(event) => changeLanguage(event.target.value as 'en' | 'es' | 'pt' | 'fr')}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-200"
              >
                <option value="en">{t('language.en')}</option>
                <option value="es">{t('language.es')}</option>
                <option value="pt">{t('language.pt')}</option>
                <option value="fr">{t('language.fr')}</option>
              </select>
              <NetworkSelector />
              <UserAvatarDropdown
                walletAddress={wallet?.publicKey}
                onSettings={() => setActiveTab('settings')}
                onNotifications={() => setActiveTab('notifications')}
                onSignOut={() => {
                  void handleWalletDisconnect();
                }}
              />
          </div>
        </header>

        <NetworkBanner />

        <section
          className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-8 lg:px-8"
          aria-label={menuItems.find((m) => m.id === activeTab)?.label}
        >
          <div className="mb-6 flex flex-col gap-3 sm:mb-8 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold sm:text-3xl">
                {menuItems.find((m) => m.id === activeTab)?.label}
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
                {activeTab === 'dashboard' &&
                  'Manage anchor operations, branding, and flow requirements from a single backend-driven surface.'}
                {activeTab === 'deposit' && 'Initiate a new on-ramp transaction via SEP-24.'}
                {activeTab === 'withdraw' && 'Initiate a new off-ramp transaction via SEP-24.'}
                {activeTab === 'history' && 'Track historical and pending transactions.'}
                {activeTab === 'sep38' && 'Request fixed or indicative cross-border conversion quotes.'}
                {activeTab === 'status' && 'Monitor Redis, database, and infrastructure health in real time.'}
                {activeTab === 'notifications' && 'View webhook events and transaction notifications.'}
                {activeTab === 'kyc' && 'Check your KYC verification status.'}
                {activeTab === 'settings' &&
                  'Preview the current branding and required fields supplied by the anchor backend.'}
              </p>
            </div>
            {loadingState === 'error' ? (
              <div
                data-testid="config-warning"
                className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200"
                role="alert"
              >
                <AlertCircle size={16} aria-hidden="true" />
                Backend UI config unavailable, using defaults
              </div>
            ) : null}
          </div>

          <StatusBanner apiBaseUrl={apiBaseUrl} />

          <AnimatePresence mode="wait">
            <motion.div
              data-testid="active-view"
              key={`${activeTab}:${walletSessionResetCounter}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Suspense fallback={<TabFallback />}>
                {activeTab === 'dashboard' && (
                  <DashboardOverview uiConfig={uiConfig} isLoading={loadingState === 'loading'} />
                )}
                {activeTab === 'deposit' && <SEP24Flow type="deposit" uiConfig={uiConfig} apiBaseUrl={apiBaseUrl} />}
                {activeTab === 'withdraw' && <SEP24Flow type="withdraw" uiConfig={uiConfig} apiBaseUrl={apiBaseUrl} />}
                {activeTab === 'history' && <TransactionHistory />}
                {activeTab === 'sep38' && <Sep38QuotePanel />}
                {activeTab === 'status' && <ServiceStatusPanel />}
                {activeTab === 'notifications' && (
                  <NotificationCenter
                    apiBaseUrl={apiBaseUrl}
                    onOpenPreferences={() => setActiveTab('notification-preferences')}
                  />
                )}
                {activeTab === 'notification-preferences' && (
                  <NotificationPreferences apiBaseUrl={apiBaseUrl} />
                )}
                {activeTab === 'kyc' && (
                  <KycStatusView
                    uiConfig={uiConfig}
                    apiBaseUrl={apiBaseUrl}
                    account={wallet?.publicKey}
                  />
                )}
                {activeTab === 'settings' && (
                  <SettingsView uiConfig={uiConfig} apiBaseUrl={apiBaseUrl} />
                )}
                {activeTab === 'contract-playground' && <ContractPlayground apiBaseUrl={apiBaseUrl} />}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
};

/** Navbar switch that flips between the light and dark palettes. */
const ThemeToggle = () => {
  const { resolvedTheme, toggleTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={resolvedTheme === 'dark'}
      onClick={toggleTheme}
      aria-label={`Switch to ${next} theme`}
      className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition-all hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {resolvedTheme === 'dark' ? (
        <Sun size={16} aria-hidden="true" />
      ) : (
        <Moon size={16} aria-hidden="true" />
      )}
      <span className="hidden sm:inline">{resolvedTheme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
};

const AppRoot = () => (
  <ThemeProvider>
    <I18nProvider>
      <NetworkProvider apiBaseUrl={apiBaseUrl}>
        <App />
      </NetworkProvider>
    </I18nProvider>
  </ThemeProvider>
);

export default AppRoot;
