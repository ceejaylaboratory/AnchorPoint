import { LogoMark } from './LogoMark';
import type { UiConfig } from '../types';

export const DashboardOverview = ({ uiConfig }: { uiConfig: UiConfig }) => (
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
            <span
              className={`text-xs ${stat.change.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'}`}
              aria-label={`Change: ${stat.change}`}
            >
              {stat.change}
            </span>
          </div>
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div
        className="glass-card flex h-64 items-center justify-center p-6"
        role="img"
        aria-label="Volume chart (placeholder)"
      >
        <p className="italic text-slate-500">Volume Chart Placeholder</p>
      </div>
      <div className="glass-card p-6">
        <h3 className="font-display text-xl font-bold">Anchor Branding</h3>
        <div className="mt-5 flex items-center gap-4">
          <LogoMark uiConfig={uiConfig} />
          <div>
            <p className="font-medium">{uiConfig.brandName}</p>
            <p className="text-sm text-slate-500">
              {uiConfig.supportEmail ?? 'Support contact not configured'}
            </p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Primary</p>
            <div className="mt-3 flex items-center gap-3">
              <span
                className="h-6 w-6 rounded-full border border-white/10"
                style={{ backgroundColor: uiConfig.primaryColor }}
                aria-label={`Primary color: ${uiConfig.primaryColor}`}
              />
              <span className="font-mono text-sm" aria-hidden="true">
                {uiConfig.primaryColor}
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Accent</p>
            <div className="mt-3 flex items-center gap-3">
              <span
                className="h-6 w-6 rounded-full border border-white/10"
                style={{ backgroundColor: uiConfig.accentColor }}
                aria-label={`Accent color: ${uiConfig.accentColor}`}
              />
              <span className="font-mono text-sm" aria-hidden="true">
                {uiConfig.accentColor}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default DashboardOverview;
