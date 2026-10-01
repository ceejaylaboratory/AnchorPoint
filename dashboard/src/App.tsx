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

// Dummy components for sections
const DashboardOverview = () => (
  <div className="space-y-6">
    {/* Responsive grid: 1 column on mobile (<640px), 3 columns on md (>=768px) */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[
        { label: 'Total Volume', value: '$128,430.00', change: '+12.5%' },
        { label: 'Active Deposits', value: '42', change: '+3' },
        { label: 'Pending Withdrawals', value: '18', change: '-2' },
      ].map((stat, i) => (
        <div key={i} className="glass-card p-4 sm:p-6">
          <p className="text-slate-400 text-sm">{stat.label}</p>
          <div className="flex items-end justify-between mt-2">
            <h3 className="text-xl sm:text-2xl font-bold font-display">{stat.value}</h3>
            <span className={`text-xs ${stat.change.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'}`}>
              {stat.change}
            </span>
          </div>
        </div>
      ))}
    </div>
    
    <div className="glass-card p-6 h-64 flex items-center justify-center">
      <p className="text-slate-500 italic">Volume Chart Placeholder</p>
    </div>
  </div>
);

const TransactionHistory = () => (
  <div className="glass-card overflow-x-auto">
    <table className="w-full text-left">
      <thead>
        <tr className="border-b border-slate-800 text-slate-400 text-sm">
          <th className="p-4 font-medium">Type</th>
          <th className="p-4 font-medium">Asset</th>
          <th className="p-4 font-medium">Amount</th>
          <th className="p-4 font-medium">Status</th>
          <th className="p-4 font-medium">Date</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800">
        {[
          { type: 'Deposit', asset: 'USDC', amount: '500.00', status: 'Completed', date: '2024-03-15' },
          { type: 'Withdrawal', asset: 'USDC', amount: '120.50', status: 'Pending', date: '2024-03-16' },
          { type: 'Deposit', asset: 'USDC', amount: '1,000.00', status: 'Processing', date: '2024-03-16' },
        ].map((tx, i) => (
          <tr key={i} className="hover:bg-slate-900/50 transition-colors">
            <td className="p-4 flex items-center gap-2">
              {tx.type === 'Deposit' ? <ArrowDownLeft size={16} className="text-emerald-400" /> : <ArrowUpRight size={16} className="text-rose-400" />}
              {tx.type}
            </td>
            <td className="p-4">{tx.asset}</td>
            <td className="p-4 font-mono">${tx.amount}</td>
            <td className="p-4">
              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                tx.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-400' : 
                tx.status === 'Pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
              }`}>
                {tx.status}
              </span>
            </td>
            <td className="p-4 text-slate-400 text-sm">{tx.date}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const SEP24Flow = ({ type }: { type: 'deposit' | 'withdraw' }) => {
  const [step, setStep] = useState(1);
  
  return (
    <div className="max-w-2xl mx-auto glass-card p-8">
      <div className="flex justify-between mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
              step >= s ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'bg-slate-800 text-slate-500'
            }`}>
              {s}
            </div>
            {s < 3 && <div className={`w-20 h-1 bg-slate-800 mx-2 ${step > s ? 'bg-primary' : ''}`} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            <h2 className="text-2xl font-bold font-display">{type === 'deposit' ? 'Deposit' : 'Withdraw'} Assets</h2>
            <p className="text-slate-400">Select the asset you want to {type === 'deposit' ? 'deposit into' : 'withdraw from'} your Stellar wallet.</p>
            <div className="grid grid-cols-1 gap-3">
              {['USDC', 'EURT', 'ARST'].map((asset) => (
                <button 
                  key={asset}
                  onClick={() => setStep(2)}
                  className="flex items-center justify-between p-4 bg-slate-900 border border-slate-700 rounded-xl hover:border-primary/50 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-primary font-bold">
                      {asset[0]}
                    </div>
                    <span>{asset}</span>
                  </div>
                  <ArrowUpRight size={18} className="text-slate-500" />
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            <h2 className="text-2xl font-bold font-display">Identity Verification</h2>
            <p className="text-slate-400">This anchor requires KYC for this transaction. Please complete the interactive flow.</p>
            <div className="bg-slate-900 aspect-video rounded-xl border border-dashed border-slate-700 flex flex-col items-center justify-center p-6 text-center">
              <ShieldCheck size={48} className="text-primary mb-4" />
              <p className="font-medium text-slate-300">Stellar Anchor Secure KYC</p>
              <p className="text-sm text-slate-500 mt-2">Placeholder for SEP-12 Interactive WebView</p>
              <button 
                onClick={() => setStep(3)}
                className="btn-primary mt-6"
              >
                Launch KYC Portal
              </button>
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-12"
          >
            <div className="w-20 h-20 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <ShieldCheck size={40} />
            </div>
            <h2 className="text-3xl font-bold font-display mb-2">Transaction Initiated</h2>
            <p className="text-slate-400 mb-8">Your {type} request has been submitted. You will be notified once the anchor processes your status.</p>
            <button 
              onClick={() => setStep(1)}
              className="text-primary hover:underline font-medium"
            >
              Back to Dashboard
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

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
        <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-background/80 px-2 py-3 backdrop-blur-md sm:px-6 lg:px-8">
          <button
            aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={sidebarOpen}
            aria-controls="main-sidebar"
            className="relative z-20 -ml-2 rounded bg-background p-2 sm:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-4">
            <div
              data-testid="backend-status"
              className="hidden items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 sm:flex"
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
                  <span className="hidden rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 sm:inline">
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
                <span className="hidden max-w-48 truncate text-xs text-rose-300 sm:inline" role="alert">
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
              {activeTab === 'dashboard' && <DashboardOverview />}
              {activeTab === 'deposit' && <SEP24Flow type="deposit" />}
              {activeTab === 'withdraw' && <SEP24Flow type="withdraw" />}
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
            </motion.div>
          </AnimatePresence>
        </section>
      </main>
    </div>
  )
}

export default App;
