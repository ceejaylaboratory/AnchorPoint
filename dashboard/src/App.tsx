import React, { useEffect, useMemo, useState } from 'react';
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
  Building2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type FieldRequirement = {
  key: string;
  label: string;
  required: boolean;
  placeholder?: string;
  helpText?: string;
};

type UiConfig = {
  brandName: string;
  logoUrl?: string;
  primaryColor: string;
  accentColor: string;
  supportEmail?: string;
  fieldRequirements: {
    deposit: FieldRequirement[];
    withdraw: FieldRequirement[];
    kyc: FieldRequirement[];
  };
};

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

const LogoMark = ({ uiConfig }: { uiConfig: UiConfig }) => {
  if (uiConfig.logoUrl) {
    return <img src={uiConfig.logoUrl} alt={`${uiConfig.brandName} logo`} className="h-10 w-10 rounded-lg object-cover" />;
  }

  return (
    <div className="p-2 bg-primary rounded-lg">
      <Building2 size={24} className="text-white" />
    </div>
  );
};

const RequirementList = ({ title, fields }: { title: string; fields: FieldRequirement[] }) => (
  <div className="glass-card p-5">
    <div className="flex items-center justify-between gap-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{fields.length} fields</span>
    </div>
    <div className="mt-4 space-y-3">
      {fields.map((field) => (
        <div key={field.key} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-slate-100">{field.label}</p>
            <span className={`text-xs font-semibold ${field.required ? 'text-amber-300' : 'text-slate-500'}`}>
              {field.required ? 'Required' : 'Optional'}
            </span>
          </div>
          {field.placeholder ? <p className="mt-1 text-sm text-slate-500">{field.placeholder}</p> : null}
          {field.helpText ? <p className="mt-1 text-sm text-slate-400">{field.helpText}</p> : null}
        </div>
      ))}
    </div>
  </div>
);

const DashboardOverview = ({ uiConfig }: { uiConfig: UiConfig }) => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {[
        { label: 'Total Volume', value: '$128,430.00', change: '+12.5%' },
        { label: 'Active Deposits', value: '42', change: '+3' },
        { label: 'Pending Withdrawals', value: '18', change: '-2' },
      ].map((stat) => (
        <div key={stat.label} className="glass-card p-6">
          <p className="text-sm text-slate-400">{stat.label}</p>
          <div className="mt-2 flex items-end justify-between">
            <h3 className="font-display text-2xl font-bold">{stat.value}</h3>
            <span className={`text-xs ${stat.change.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'}`}>
              {stat.change}
            </span>
          </div>
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="glass-card flex h-64 items-center justify-center p-6">
        <p className="italic text-slate-500">Volume Chart Placeholder</p>
      </div>
      <div className="glass-card p-6">
        <h3 className="font-display text-xl font-bold">Anchor Branding</h3>
        <div className="mt-5 flex items-center gap-4">
          <LogoMark uiConfig={uiConfig} />
          <div>
            <p className="font-medium">{uiConfig.brandName}</p>
            <p className="text-sm text-slate-500">{uiConfig.supportEmail ?? 'Support contact not configured'}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Primary</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-6 w-6 rounded-full border border-white/10" style={{ backgroundColor: uiConfig.primaryColor }} />
              <span className="font-mono text-sm">{uiConfig.primaryColor}</span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Accent</p>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-6 w-6 rounded-full border border-white/10" style={{ backgroundColor: uiConfig.accentColor }} />
              <span className="font-mono text-sm">{uiConfig.accentColor}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

const TransactionHistory = () => (
  <div className="glass-card overflow-x-auto">
    <table className="w-full text-left">
      <thead>
        <tr className="border-b border-slate-800 text-sm text-slate-400">
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
        ].map((tx) => (
          <tr key={`${tx.type}-${tx.amount}-${tx.date}`} className="transition-colors hover:bg-slate-900/50">
            <td className="flex items-center gap-2 p-4">
              {tx.type === 'Deposit' ? <ArrowDownLeft size={16} className="text-emerald-400" /> : <ArrowUpRight size={16} className="text-rose-400" />}
              {tx.type}
            </td>
            <td className="p-4">{tx.asset}</td>
            <td className="p-4 font-mono">${tx.amount}</td>
            <td className="p-4">
              <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                tx.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-400' :
                tx.status === 'Pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
              }`}>
                {tx.status}
              </span>
            </td>
            <td className="p-4 text-sm text-slate-400">{tx.date}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const SEP24Flow = ({ type, uiConfig }: { type: 'deposit' | 'withdraw'; uiConfig: UiConfig }) => {
  const [step, setStep] = useState(1);
  const transactionFields = uiConfig.fieldRequirements[type];

  return (
    <div className="mx-auto max-w-4xl glass-card p-8">
      <div className="mb-8 flex justify-between">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full font-bold transition-all ${
              step >= s ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'bg-slate-800 text-slate-500'
            }`}>
              {s}
            </div>
            {s < 3 && <div className={`mx-2 h-1 w-20 bg-slate-800 ${step > s ? 'bg-primary' : ''}`} />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"
          >
            <div className="space-y-4">
              <h2 className="font-display text-2xl font-bold">{type === 'deposit' ? 'Deposit' : 'Withdraw'} Assets</h2>
              <p className="text-slate-400">The anchor is supplying the field requirements for this flow from the backend configuration.</p>
              <div className="grid grid-cols-1 gap-3">
                {['USDC', 'EURT', 'ARST'].map((asset) => (
                  <button
                    key={asset}
                    onClick={() => setStep(2)}
                    className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900 p-4 transition-all hover:border-primary/50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 font-bold text-primary">
                        {asset[0]}
                      </div>
                      <span>{asset}</span>
                    </div>
                    <ArrowUpRight size={18} className="text-slate-500" />
                  </button>
                ))}
              </div>
            </div>

            <RequirementList title={`${type === 'deposit' ? 'Deposit' : 'Withdrawal'} Requirements`} fields={transactionFields} />
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"
          >
            <div className="space-y-4">
              <h2 className="font-display text-2xl font-bold">Identity Verification</h2>
              <p className="text-slate-400">KYC requirements are also backend-driven, so each anchor can tighten or relax the form without redeploying the dashboard.</p>
              <div className="aspect-video rounded-xl border border-dashed border-slate-700 bg-slate-900 p-6 text-center">
                <div className="flex h-full flex-col items-center justify-center">
                  <ShieldCheck size={48} className="mb-4 text-primary" />
                  <p className="font-medium text-slate-300">{uiConfig.brandName} Secure KYC</p>
                  <p className="mt-2 text-sm text-slate-500">Placeholder for SEP-12 interactive webview</p>
                  <button onClick={() => setStep(3)} className="btn-primary mt-6">
                    Launch KYC Portal
                  </button>
                </div>
              </div>
            </div>

            <RequirementList title="KYC Requirements" fields={uiConfig.fieldRequirements.kyc} />
          </motion.div>
        )}

        {step === 3 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="py-12 text-center"
          >
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500">
              <CheckCircle2 size={40} />
            </div>
            <h2 className="mb-2 font-display text-3xl font-bold">Transaction Initiated</h2>
            <p className="mb-8 text-slate-400">Your {type} request has been submitted with {uiConfig.brandName} branding and field rules pulled from the backend.</p>
            <button onClick={() => setStep(1)} className="font-medium text-primary hover:underline">
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
        if (!ignore && payload?.data) {
          setUiConfig(payload.data as UiConfig);
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

  const menuItems = useMemo(() => [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Overview' },
    { id: 'deposit', icon: ArrowDownLeft, label: 'Deposit' },
    { id: 'withdraw', icon: ArrowUpRight, label: 'Withdraw' },
    { id: 'history', icon: History, label: 'History' },
    { id: 'kyc', icon: ShieldCheck, label: 'KYC Status' },
    { id: 'settings', icon: Settings, label: 'Settings' },
  ], []);

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
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 transform border-r border-slate-800 bg-card transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0`}>
        <div className="p-6">
          <div className="mb-10 flex items-center gap-3">
            <LogoMark uiConfig={uiConfig} />
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-bold tracking-tight">{uiConfig.brandName}</h1>
              <p className="truncate text-xs uppercase tracking-[0.2em] text-slate-500">Anchor dashboard</p>
            </div>
          </div>

          <nav className="space-y-1">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-all ${
                  activeTab === item.id
                    ? 'border border-primary/20 bg-primary/10 text-primary'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <item.icon size={20} />
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="absolute bottom-0 w-full border-t border-slate-800 p-6">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-slate-800" />
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium">Institutional Admin</p>
              <p className="truncate text-xs text-slate-500">{loadingState === 'ready' ? 'Backend config synced' : loadingState === 'error' ? 'Using fallback config' : 'Loading config'}</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-800 bg-background/50 px-8 backdrop-blur-md">
          <button className="lg:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X /> : <Menu />}
          </button>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 md:flex">
              <div className={`h-2 w-2 rounded-full ${loadingState === 'error' ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`} />
              <span className="text-xs font-semibold text-slate-300">
                {loadingState === 'error' ? 'Fallback Theme Active' : 'Config Connected'}
              </span>
            </div>
            <button className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 transition-all hover:bg-slate-800">
              <Wallet size={18} />
              <span className="text-sm font-medium">Connect Wallet</span>
            </button>
          </div>
        </header>

        <section className="mx-auto w-full max-w-7xl p-8">
          <div className="mb-8 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-display text-3xl font-bold">
                {menuItems.find((m) => m.id === activeTab)?.label}
              </h2>
              <p className="mt-1 text-slate-400">
                {activeTab === 'dashboard' && 'Manage anchor operations, branding, and flow requirements from a single backend-driven surface.'}
                {activeTab === 'deposit' && 'Initiate a new on-ramp transaction via SEP-24.'}
                {activeTab === 'withdraw' && 'Initiate a new off-ramp transaction via SEP-24.'}
                {activeTab === 'history' && 'Track historical and pending transactions.'}
                {activeTab === 'settings' && 'Preview the current branding and required fields supplied by the anchor backend.'}
              </p>
            </div>
            {loadingState === 'error' ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
                <AlertCircle size={16} />
                Backend UI config unavailable, using defaults
              </div>
            ) : null}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'dashboard' && <DashboardOverview uiConfig={uiConfig} />}
              {activeTab === 'deposit' && <SEP24Flow type="deposit" uiConfig={uiConfig} />}
              {activeTab === 'withdraw' && <SEP24Flow type="withdraw" uiConfig={uiConfig} />}
              {activeTab === 'history' && <TransactionHistory />}
              {activeTab === 'kyc' && (
                <div className="glass-card p-12 text-center">
                  <ShieldCheck size={64} className="mx-auto mb-4 text-primary" />
                  <h3 className="text-xl font-bold">Identity Verification</h3>
                  <p className="mt-2 text-slate-400">Current KYC requirements are being sourced from the active backend configuration.</p>
                  <div className="mx-auto mt-8 max-w-3xl">
                    <RequirementList title="Configured KYC Fields" fields={uiConfig.fieldRequirements.kyc} />
                  </div>
                </div>
              )}
              {activeTab === 'settings' && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="glass-card p-8">
                    <h3 className="mb-4 text-xl font-bold">Branding Configuration</h3>
                    <div className="space-y-6">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-400">Brand Name</label>
                        <input type="text" value={uiConfig.brandName} readOnly className="input-field w-full" />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-slate-400">Logo URL</label>
                        <input type="text" value={uiConfig.logoUrl ?? 'Not configured'} readOnly className="input-field w-full" />
                      </div>
                      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-400">Primary Color</label>
                          <div className="flex gap-2">
                            <input type="color" value={uiConfig.primaryColor} readOnly className="h-10 w-10 cursor-default border-0 bg-transparent" />
                            <input type="text" value={uiConfig.primaryColor} readOnly className="input-field flex-1" />
                          </div>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-400">Accent Color</label>
                          <div className="flex gap-2">
                            <input type="color" value={uiConfig.accentColor} readOnly className="h-10 w-10 cursor-default border-0 bg-transparent" />
                            <input type="text" value={uiConfig.accentColor} readOnly className="input-field flex-1" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    <RequirementList title="Deposit Fields" fields={uiConfig.fieldRequirements.deposit} />
                    <RequirementList title="Withdrawal Fields" fields={uiConfig.fieldRequirements.withdraw} />
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
};

export default App;
