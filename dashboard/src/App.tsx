import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { UiConfig } from './types';
import { LogoMark } from './components/LogoMark';
import { NotificationBell } from './components/NotificationBell';
import { CopyablePublicKey } from './components/CopyablePublicKey';
import { FreighterAdapter } from './lib/wallet/FreighterAdapter';

const DashboardOverview = lazy(() => import('./components/DashboardOverview'));
const TransactionHistory = lazy(() => import('./components/TransactionHistory'));
const SEP24Flow = lazy(() => import('./components/SEP24Flow'));
const KycStatusView = lazy(() => import('./components/KycStatusView'));
const NotificationCenter = lazy(() => import('./components/NotificationCenter'));
const NotificationPreferences = lazy(() => import('./components/NotificationPreferences'));
const AdminControls = lazy(() => import('./components/AdminControls'));
const Sep38QuotePanel = lazy(() => import('./components/Sep38QuotePanel'));
const ServiceStatusPanel = lazy(() => import('./components/ServiceStatusPanel'));
const SettingsView = lazy(() => import('./components/SettingsView'));

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
      { key: 'bankAccount', label: 'Bank Account', required: true, placeholder: 'Account number' },
      { key: 'amount', label: 'Amount', required: true, placeholder: '120.50' },
    ],
    kyc: [
      { key: 'firstName', label: 'First Name', required: true },
      { key: 'lastName', label: 'Last Name', required: true },
      { key: 'country', label: 'Country', required: true },
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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uiConfig, setUiConfig] = useState<UiConfig>(defaultUiConfig);
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [wallet, setWallet] = useState<{ publicKey: string; network: string } | null>(null);
  const [walletStatus, setWalletStatus] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [walletError, setWalletError] = useState('');
  const walletAdapter = useMemo(() => new FreighterAdapter(), []);

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
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const handleMediaChange = (event: MediaQueryListEvent) => setSidebarOpen(event.matches);

    setSidebarOpen(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  const menuItems = useMemo(
    () => [
      { id: 'dashboard', icon: LayoutDashboard, label: 'Overview' },
      { id: 'deposit', icon: ArrowDownLeft, label: 'Deposit' },
      { id: 'withdraw', icon: ArrowUpRight, label: 'Withdraw' },
      { id: 'history', icon: History, label: 'History' },
      { id: 'sep38', icon: RefreshCcw, label: 'SEP-38 Quote' },
      { id: 'status', icon: Activity, label: 'Service Status' },
      { id: 'notifications', icon: Bell, label: 'Notifications' },
      { id: 'kyc', icon: ShieldCheck, label: 'KYC Status' },
      { id: 'settings', icon: Settings, label: 'Settings' },
    ],
    [],
  );

  const handleConnectWallet = async () => {
    setWalletStatus('connecting');
    setWalletError('');

    try {
      const connectedWallet = await walletAdapter.connect();
      setWallet(connectedWallet);
      setWalletStatus('idle');
    } catch (error) {
      setWalletStatus('error');
      setWalletError(error instanceof Error ? error.message : 'Unable to connect wallet.');
    }
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
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation menu overlay"
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        data-testid="sidebar"
        id="main-sidebar"
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-50 w-[min(18rem,calc(100vw-2rem))] transform border-r border-slate-800 bg-card transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:w-64 lg:translate-x-0`}
      >
        <div className="p-5 sm:p-6">
          <div className="mb-8 flex items-center gap-3 sm:mb-10">
            <LogoMark uiConfig={uiConfig} />
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-bold tracking-tight">
                {uiConfig.brandName}
              </h1>
              <p className="truncate text-xs uppercase tracking-[0.2em] text-slate-400">
                Anchor dashboard
              </p>
            </div>
          </div>

          <nav aria-label="Primary navigation">
            <ul className="space-y-1 list-none p-0 m-0">
              {menuItems.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => {
                      setActiveTab(item.id);
                      setSidebarOpen(false);
                    }}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                      activeTab === item.id
                        ? 'border border-primary/40 bg-primary/10 text-primary-text'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    <item.icon size={20} aria-hidden="true" />
                    <span className="font-medium">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="absolute bottom-0 w-full border-t border-slate-800 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-slate-800" aria-hidden="true" />
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium">Institutional Admin</p>
              <p className="truncate text-xs text-slate-400">
                {loadingState === 'ready'
                  ? 'Backend config synced'
                  : loadingState === 'error'
                    ? 'Using fallback config'
                    : 'Loading config'}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 bg-background/80 px-3 py-3 backdrop-blur-md sm:px-6 lg:px-8">
          <button
            aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={sidebarOpen}
            aria-controls="main-sidebar"
            className="rounded p-2 -ml-2 lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
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
            <div className="flex min-w-0 items-center gap-2">
              {wallet ? (
                <CopyablePublicKey publicKey={wallet.publicKey} label={`${wallet.network} public key`} />
              ) : (
                <button
                  type="button"
                  onClick={handleConnectWallet}
                  disabled={walletStatus === 'connecting'}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:px-4"
                >
                  <Wallet size={18} aria-hidden="true" />
                  <span className="hidden text-sm font-medium sm:inline">
                    {walletStatus === 'connecting' ? 'Connecting...' : 'Connect Wallet'}
                  </span>
                </button>
              )}
              {walletStatus === 'error' && !wallet ? (
                <span className="hidden max-w-48 truncate text-xs text-rose-300 md:inline" role="alert">
                  {walletError}
                </span>
              ) : null}
            </div>
          </div>
        </header>

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

          <AnimatePresence mode="wait">
            <motion.div
              data-testid="active-view"
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Suspense fallback={<TabFallback />}>
                {activeTab === 'dashboard' && <DashboardOverview uiConfig={uiConfig} />}
                {activeTab === 'deposit' && <SEP24Flow type="deposit" uiConfig={uiConfig} />}
                {activeTab === 'withdraw' && <SEP24Flow type="withdraw" uiConfig={uiConfig} />}
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
                {activeTab === 'kyc' && <KycStatusView uiConfig={uiConfig} />}
                {activeTab === 'settings' && (
                  <SettingsView uiConfig={uiConfig} apiBaseUrl={apiBaseUrl} />
                )}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
};

export default App;
