import { useState } from 'react';
import { ShieldCheck, XCircle, AlertTriangle, RefreshCw, Mail, CheckCircle2, Clock } from 'lucide-react';
import type { UiConfig } from '../types';
import { RequirementList } from './RequirementList';

export type KycState = 'not_started' | 'pending' | 'approved' | 'rejected';

export const KycStatusView = ({ uiConfig }: { uiConfig: UiConfig }) => {
  // For demo/testing purposes, default to 'rejected' as per issue #343
  const [kycState, setKycState] = useState<KycState>('rejected');

  return (
    <div className="space-y-6">
      {/* Dev Toggle for previewing states */}
      <div className="flex items-center gap-3 p-4 glass-card border-dashed border-slate-700/50 overflow-x-auto">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center shrink-0">Preview State:</span>
        {(['not_started', 'pending', 'approved', 'rejected'] as KycState[]).map((s) => (
          <button
            key={s}
            onClick={() => setKycState(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 shrink-0 ${
              kycState === s
                ? 'bg-primary/20 border-primary/50 text-primary shadow-sm shadow-primary/10'
                : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-300'
            }`}
          >
            {s.replace('_', ' ').toUpperCase()}
          </button>
        ))}
      </div>

      <div className="glass-card p-8 md:p-16 text-center relative overflow-hidden">
        {/* Background ambient glow based on state */}
        <div 
          className={`absolute top-0 left-1/2 -translate-x-1/2 w-[150%] md:w-full h-48 blur-[100px] opacity-10 pointer-events-none transition-colors duration-700 ${
            kycState === 'rejected' ? 'bg-rose-500' :
            kycState === 'approved' ? 'bg-emerald-500' :
            kycState === 'pending' ? 'bg-amber-500' : 'bg-primary'
          }`} 
        />

        {kycState === 'not_started' && (
          <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
            <ShieldCheck size={64} className="mb-6 text-primary" aria-hidden="true" />
            <h3 className="text-2xl font-display font-bold text-slate-100">Identity Verification</h3>
            <p className="mt-3 text-slate-400 max-w-lg leading-relaxed">
              Current KYC requirements are being sourced from the active backend configuration. Complete your verification to unlock all features.
            </p>
            <div className="mt-10 w-full max-w-xl text-left bg-slate-900/50 p-6 rounded-2xl border border-slate-800/50">
              <RequirementList title="Required Information" fields={uiConfig.fieldRequirements.kyc} />
            </div>
            <button className="mt-8 btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
              Start Verification
            </button>
          </div>
        )}

        {kycState === 'pending' && (
          <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-500/10 mb-8 border border-amber-500/20 shadow-[0_0_40px_-10px_rgba(245,158,11,0.2)]">
              <Clock size={40} className="text-amber-400 animate-pulse" aria-hidden="true" />
            </div>
            <h3 className="text-3xl font-display font-bold text-slate-100">Verification in Progress</h3>
            <p className="mt-4 text-slate-400 max-w-lg text-lg leading-relaxed">
              Your identity information is currently being reviewed by our compliance team. This typically takes 1-2 business days.
            </p>
            <div className="mt-8 px-5 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-200 text-sm max-w-md shadow-inner">
              We will notify you via email once the review is complete.
            </div>
          </div>
        )}

        {kycState === 'approved' && (
          <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/10 mb-8 border border-emerald-500/20 shadow-[0_0_40px_-10px_rgba(16,185,129,0.2)]">
              <CheckCircle2 size={48} className="text-emerald-400" aria-hidden="true" />
            </div>
            <h3 className="text-3xl font-display font-bold text-slate-100">Identity Verified</h3>
            <p className="mt-4 text-slate-400 max-w-lg text-lg leading-relaxed">
              Your identity has been successfully verified. You now have full access to deposit and withdrawal features.
            </p>
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Account Status</p>
                <div className="flex items-center justify-center gap-2 text-emerald-400 font-medium">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  Level 2 Verified
                </div>
              </div>
              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Daily Limits</p>
                <p className="text-slate-200 font-medium">$50,000.00</p>
              </div>
            </div>
          </div>
        )}

        {kycState === 'rejected' && (
          <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-rose-500/10 mb-8 border border-rose-500/20 shadow-[0_0_40px_-10px_rgba(244,63,94,0.3)]">
              <XCircle size={48} className="text-rose-500" aria-hidden="true" />
            </div>
            <h3 className="text-3xl font-display font-bold text-slate-100">Verification Failed</h3>
            <p className="mt-4 text-slate-400 max-w-lg text-lg leading-relaxed">
              We were unable to verify your identity with the provided information. This may happen if documents are unclear, expired, or details mismatch.
            </p>

            <div className="mt-10 w-full max-w-lg text-left">
              <div className="flex items-start gap-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 shadow-inner">
                <AlertTriangle size={24} className="text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h4 className="text-sm font-semibold text-rose-200 tracking-wide">Reason for Rejection</h4>
                  <p className="mt-2 text-sm text-rose-200/80 leading-relaxed">
                    The submitted proof of identity document appears to be blurry or unreadable. Please ensure all text is legible and all four corners of the document are visible before re-submitting.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10 flex flex-col sm:flex-row gap-4 w-full max-w-lg justify-center">
              <button 
                onClick={() => setKycState('not_started')}
                className="flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-500 px-8 py-3 text-sm font-medium text-white shadow-lg shadow-rose-500/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
              >
                <RefreshCw size={16} aria-hidden="true" />
                Resubmit KYC
              </button>
              <a 
                href={`mailto:${uiConfig.supportEmail || 'support@example.com'}`}
                className="flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 px-8 py-3 text-sm font-medium text-slate-300 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50"
              >
                <Mail size={16} aria-hidden="true" />
                Contact Support
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KycStatusView;
