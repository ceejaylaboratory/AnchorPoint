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
  Wallet
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';

const DashboardOverview = lazy(() =>
  import('./components/DashboardOverview').then((module) => ({ default: module.DashboardOverview })),
);

const TransactionHistory = lazy(() =>
  import('./components/TransactionHistory').then((module) => ({ default: module.TransactionHistory })),
);

const SEP24Flow = lazy(() =>
  import('./components/SEP24Flow').then((module) => ({ default: module.SEP24Flow })),
);

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Overview' },
    { id: 'deposit', icon: ArrowDownLeft, label: 'Deposit' },
    { id: 'withdraw', icon: ArrowUpRight, label: 'Withdraw' },
    { id: 'history', icon: History, label: 'History' },
    { id: 'kyc', icon: ShieldCheck, label: 'KYC Status' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ];

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

        <section className="p-8 max-w-7xl mx-auto w-full">
          <div className="mb-8">
            <h2 className="text-3xl font-bold font-display">
              {menuItems.find(m => m.id === activeTab)?.label}
            </h2>
            <p className="text-slate-400 mt-1">
              {activeTab === 'dashboard' && 'Manage your anchor operations and liquidity.'}
              {activeTab === 'deposit' && 'Initiate a new on-ramp transaction via SEP-24.'}
              {activeTab === 'withdraw' && 'Initiate a new off-ramp transaction via SEP-24.'}
              {activeTab === 'history' && 'Track historical and pending transactions.'}
            </p>
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
              <GlobalErrorBoundary compact>
                <Suspense fallback={<div role="status" className="py-8 text-center text-slate-400">Loading section...</div>}>
                  {activeTab === 'dashboard' && <DashboardOverview uiConfig={uiConfig} />}
                  {activeTab === 'deposit' && <SEP24Flow type="deposit" uiConfig={uiConfig} apiBaseUrl={apiBaseUrl} />}
                  {activeTab === 'withdraw' && <SEP24Flow type="withdraw" uiConfig={uiConfig} apiBaseUrl={apiBaseUrl} />}
                  {activeTab === 'history' && <TransactionHistory />}
                  {activeTab === 'kyc' && (
                    <div className="glass-card p-12 text-center">
                      <ShieldCheck size={64} className="mx-auto text-primary mb-4" />
                      <h3 className="text-xl font-bold">Identity Verification</h3>
                      <p className="text-slate-400 mt-2">All customers are currently verified.</p>
                    </div>
                  )}
                  {activeTab === 'settings' && (
                    <div className="glass-card p-8">
                      <h3 className="text-xl font-bold mb-4">Branding Customization</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-slate-400 mb-2">Primary Color</label>
                          <div className="flex gap-2">
                            <input type="color" defaultValue="#3b82f6" className="w-10 h-10 border-0 bg-transparent cursor-pointer" />
                            <input type="text" value="#3b82f6" readOnly className="input-field flex-1" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-400 mb-2">Accent Color</label>
                          <div className="flex gap-2">
                            <input type="color" defaultValue="#8b5cf6" className="w-10 h-10 border-0 bg-transparent cursor-pointer" />
                            <input type="text" value="#8b5cf6" readOnly className="input-field flex-1" />
                          </div>
                        </div>
                      </div>
                      <button className="btn-primary mt-8">Apply Changes</button>
                    </div>
                  )}
                </Suspense>
              </GlobalErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </section>
      </main>
    </div>
  )
}

export default App;
