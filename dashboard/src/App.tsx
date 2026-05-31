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
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { UiConfig } from './types';
import { LogoMark } from './components/LogoMark';
import { RequirementList } from './components/RequirementList';

// Lazy-load heavy tab views so they are only fetched when first visited
const DashboardOverview = lazy(() => import('./components/DashboardOverview'));
const TransactionHistory = lazy(() => import('./components/TransactionHistory'));
const SEP24Flow = lazy(() => import('./components/SEP24Flow'));
const KycStatusView = lazy(() => import('./components/KycStatusView'));

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

const TabFallback = () => (
  <div className="flex h-48 items-center justify-center" role="status" aria-label="Loading content">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-primary" />
  </div>
);

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [uiConfig, setUiConfig] = useState<UiConfig>(defaultUiConfig);
  const [loadingState, setLoadingState] = useState<'loading' | 'ready' | 'error'>('loading');

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
      { id: 'kyc', icon: ShieldCheck, label: 'KYC Status' },
      { id: 'settings', icon: Settings, label: 'Settings' },
    ],
    [],
  );

  return (
    <div
      className="min-h-screen flex"
      style={
        {
          ['--primary' as string]: uiConfig.primaryColor,
          ['--accent' as string]: uiConfig.accentColor,
        } as React.CSSProperties
      }
    >
      <aside
        data-testid="sidebar"
        id="main-sidebar"
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 z-50 w-64 transform border-r border-slate-800 bg-card transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0`}
      >
        <div className="p-6">
          <div className="mb-10 flex items-center gap-3">
            <LogoMark uiConfig={uiConfig} />
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-bold tracking-tight">
                {uiConfig.brandName}
              </h1>
              <p className="truncate text-xs uppercase tracking-[0.2em] text-slate-500">
                Anchor dashboard
              </p>
            </div>
          </div>

          <nav aria-label="Primary navigation">
            <ul className="space-y-1 list-none p-0 m-0">
              {menuItems.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => setActiveTab(item.id)}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                      activeTab === item.id
                        ? 'border border-primary/20 bg-primary/10 text-primary'
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

        <div className="absolute bottom-0 w-full border-t border-slate-800 p-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-slate-800" aria-hidden="true" />
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium">Institutional Admin</p>
              <p className="truncate text-xs text-slate-500">
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
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-800 bg-background/50 px-8 backdrop-blur-md">
          <button
            aria-label="Toggle navigation"
            className="lg:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X /> : <Menu />}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-800 bg-background/50 px-4 sm:px-6 lg:px-8 backdrop-blur-md">
          <button
            aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={sidebarOpen}
            aria-controls="main-sidebar"
            className="lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>

          <div className="flex items-center gap-4">
            <div
              data-testid="backend-status"
              className="hidden items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 md:flex"
            >
              <div className={`h-2 w-2 rounded-full ${loadingState === 'error' ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`} />
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
            <button className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 transition-all hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
              <Wallet size={18} aria-hidden="true" />
              <span className="text-sm font-medium">Connect Wallet</span>
            </button>
          </div>
        </header>

        <section
          className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8"
          aria-label={menuItems.find((m) => m.id === activeTab)?.label}
        >
          <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-display text-3xl font-bold">
                {menuItems.find((m) => m.id === activeTab)?.label}
              </h2>
              <p className="mt-1 text-slate-400">
                {activeTab === 'dashboard' &&
                  'Manage anchor operations, branding, and flow requirements from a single backend-driven surface.'}
                {activeTab === 'deposit' && 'Initiate a new on-ramp transaction via SEP-24.'}
                {activeTab === 'withdraw' && 'Initiate a new off-ramp transaction via SEP-24.'}
                {activeTab === 'history' && 'Track historical and pending transactions.'}
                {activeTab === 'settings' &&
                  'Preview the current branding and required fields supplied by the anchor backend.'}
              </p>
            </div>
            {loadingState === 'error' ? (
              <div
                data-testid="config-warning"
                className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200"
              >
                <AlertCircle size={16} />
                className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200"
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
                {activeTab === 'kyc' && <KycStatusView uiConfig={uiConfig} />}
                {activeTab === 'settings' && (
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                    <div className="glass-card p-8">
                      <h3 className="mb-4 text-xl font-bold">Branding Configuration</h3>
                      <div className="space-y-6">
                        <div>
                          <label htmlFor="brand-name" className="mb-2 block text-sm font-medium text-slate-400">
                            Brand Name
                          </label>
                          <input
                            id="brand-name"
                            type="text"
                            value={uiConfig.brandName}
                            readOnly
                            aria-readonly="true"
                            className="input-field w-full"
                          />
                        </div>
                        <div>
                          <label htmlFor="logo-url" className="mb-2 block text-sm font-medium text-slate-400">
                            Logo URL
                          </label>
                          <input
                            id="logo-url"
                            type="text"
                            value={uiConfig.logoUrl ?? 'Not configured'}
                            readOnly
                            aria-readonly="true"
                            className="input-field w-full"
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <div>
                            <label htmlFor="primary-color-hex" className="mb-2 block text-sm font-medium text-slate-400">
                              Primary Color
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="color"
                                value={uiConfig.primaryColor}
                                readOnly
                                aria-label={`Primary color preview: ${uiConfig.primaryColor}`}
                                className="h-10 w-10 cursor-default border-0 bg-transparent"
                              />
                              <input
                                id="primary-color-hex"
                                type="text"
                                value={uiConfig.primaryColor}
                                readOnly
                                aria-readonly="true"
                                className="input-field flex-1"
                              />
                            </div>
                          </div>
                          <div>
                            <label htmlFor="accent-color-hex" className="mb-2 block text-sm font-medium text-slate-400">
                              Accent Color
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="color"
                                value={uiConfig.accentColor}
                                readOnly
                                aria-label={`Accent color preview: ${uiConfig.accentColor}`}
                                className="h-10 w-10 cursor-default border-0 bg-transparent"
                              />
                              <input
                                id="accent-color-hex"
                                type="text"
                                value={uiConfig.accentColor}
                                readOnly
                                aria-readonly="true"
                                className="input-field flex-1"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                      <RequirementList
                        title="Deposit Fields"
                        fields={uiConfig.fieldRequirements.deposit}
                      />
                      <RequirementList
                        title="Withdrawal Fields"
                        fields={uiConfig.fieldRequirements.withdraw}
                      />
                    </div>
                  </div>
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
