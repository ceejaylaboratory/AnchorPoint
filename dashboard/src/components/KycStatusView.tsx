import { useState } from 'react';
import { ShieldCheck, XCircle, AlertTriangle, RefreshCw, Mail, CheckCircle2, Clock, FileWarning, User, MapPin, Camera } from 'lucide-react';
import type { UiConfig } from '../types';
import { RequirementList } from './RequirementList';
import { KycDocumentUpload } from './KycDocumentUpload';
import { KycForm } from './KycForm';

export type KycState = 'not_started' | 'pending' | 'approved' | 'rejected';

type RejectionCategory = 'Document' | 'Identity' | 'Address' | 'Selfie';

type KycRejectionReason = {
  code: string;
  category: RejectionCategory;
  field: string;
  description: string;
  action: string;
  severity: 'high' | 'medium';
};

const CATEGORY_ICON: Record<RejectionCategory, React.ReactNode> = {
  Document: <FileWarning size={14} aria-hidden="true" />,
  Identity: <User size={14} aria-hidden="true" />,
  Address: <MapPin size={14} aria-hidden="true" />,
  Selfie: <Camera size={14} aria-hidden="true" />,
};

const KYC_REJECTION_REASONS: KycRejectionReason[] = [
  {
    code: 'DOC_BLURRY',
    category: 'Document',
    field: 'Proof of Identity',
    description:
      'The submitted identity document appears blurry or unreadable. All text, including name and document number, must be clearly legible.',
    action:
      'Retake the photo in good lighting so that all four corners and all printed text are fully visible.',
    severity: 'high',
  },
  {
    code: 'SELFIE_MISMATCH',
    category: 'Selfie',
    field: 'Selfie Verification',
    description:
      'The selfie photo does not match the identity document photo with sufficient confidence.',
    action:
      'Submit a clear, well-lit selfie facing the camera directly without glasses, hats, or face coverings.',
    severity: 'high',
  },
  {
    code: 'ADDR_OUTDATED',
    category: 'Address',
    field: 'Proof of Address',
    description:
      'The provided proof of address is older than 90 days and cannot be accepted under current compliance rules.',
    action:
      'Provide a utility bill, bank statement, or official government letter dated within the last 90 days.',
    severity: 'medium',
  },
];

type KycStatusViewProps = {
  uiConfig: UiConfig;
  apiBaseUrl: string;
  account?: string;
};

export const KycStatusView = ({ uiConfig, apiBaseUrl, account }: KycStatusViewProps) => {
  const [kycState, setKycState] = useState<KycState>('not_started');
  const [customerCreated, setCustomerCreated] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 overflow-x-auto border-dashed border-slate-700/50 glass-card p-4">
        <span className="flex shrink-0 items-center text-xs font-semibold uppercase tracking-wider text-slate-500">
          Preview State:
        </span>
        {(['not_started', 'pending', 'approved', 'rejected'] as KycState[]).map((s) => (
          <button
            key={s}
            onClick={() => setKycState(s)}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              kycState === s
                ? 'border-primary/50 bg-primary/20 text-primary shadow-sm shadow-primary/10'
                : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-600 hover:text-slate-300'
            }`}
          >
            {s.replace('_', ' ').toUpperCase()}
          </button>
        ))}
      </div>

      <div className="glass-card relative overflow-hidden p-8 text-center md:p-16">
        <div
          className={`pointer-events-none absolute left-1/2 top-0 h-48 w-[150%] -translate-x-1/2 blur-[100px] opacity-10 transition-colors duration-700 md:w-full ${
            kycState === 'rejected'
              ? 'bg-rose-500'
              : kycState === 'approved'
                ? 'bg-emerald-500'
                : kycState === 'pending'
                  ? 'bg-amber-500'
                  : 'bg-primary'
          }`}
        />

        {kycState === 'not_started' && (
          <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
            <ShieldCheck size={64} className="mb-6 text-primary-text" aria-hidden="true" />
            <h3 className="font-display text-2xl font-bold text-slate-100">Identity Verification</h3>
            <p className="mt-3 max-w-lg leading-relaxed text-slate-400">
              Current KYC requirements are being sourced from the active backend configuration. Complete your
              verification to unlock all features.
            </p>
            <div className="mt-10 w-full max-w-xl rounded-2xl border border-slate-800/50 bg-slate-900/50 p-6 text-left">
              <RequirementList
                title="Required Information"
                fields={uiConfig.fieldRequirements.kyc.filter((f) => f.type !== 'file')}
              />
            </div>
            <div className="mt-8 w-full max-w-xl text-left">
              <KycForm onSubmit={() => setCustomerCreated(true)} />
              {customerCreated && (
                <p className="mt-3 text-sm text-slate-400">
                  Next, upload the supporting documents below to complete verification.
                </p>
              )}
            </div>
            {account ? (
              <KycDocumentUpload
                apiBaseUrl={apiBaseUrl}
                account={account}
                fields={uiConfig.fieldRequirements.kyc}
                onComplete={() => setKycState('pending')}
              />
            ) : (
              <p className="mt-8 text-sm text-amber-300/90">
                Connect your wallet to upload KYC documents.
              </p>
            )}
          </div>
        )}

        {kycState === 'pending' && (
          <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
            <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10 shadow-[0_0_40px_-10px_rgba(245,158,11,0.2)]">
              <Clock size={40} className="animate-pulse text-amber-400" aria-hidden="true" />
            </div>
            <h3 className="font-display text-3xl font-bold text-slate-100">Verification in Progress</h3>
            <p className="mt-4 max-w-lg text-lg leading-relaxed text-slate-400">
              Your identity information is currently being reviewed by our compliance team. This typically takes 1-2
              business days.
            </p>
            <div className="mt-8 max-w-md rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-3 text-sm text-amber-200 shadow-inner">
              We will notify you via email once the review is complete.
            </div>
          </div>
        )}

        {kycState === 'approved' && (
          <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
            <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 shadow-[0_0_40px_-10px_rgba(16,185,129,0.2)]">
              <CheckCircle2 size={48} className="text-emerald-400" aria-hidden="true" />
            </div>
            <h3 className="font-display text-3xl font-bold text-slate-100">Identity Verified</h3>
            <p className="mt-4 max-w-lg text-lg leading-relaxed text-slate-400">
              Your identity has been successfully verified. You now have full access to deposit and withdrawal features.
            </p>
            <div className="mt-10 grid w-full max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Account Status</p>
                <div className="flex items-center justify-center gap-2 font-medium text-emerald-400">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  Level 2 Verified
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Daily Limits</p>
                <p className="font-medium text-slate-200">$50,000.00</p>
              </div>
            </div>
          </div>
        )}

        {kycState === 'rejected' && (
          <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
            <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full border border-rose-500/20 bg-rose-500/10 shadow-[0_0_40px_-10px_rgba(244,63,94,0.3)]">
              <XCircle size={48} className="text-rose-500" aria-hidden="true" />
            </div>
            <h3 className="text-3xl font-display font-bold text-slate-100">Verification Failed</h3>
            <p className="mt-4 text-slate-400 max-w-lg text-lg leading-relaxed">
              We were unable to verify your identity. Please review each issue below and resubmit with the corrected documents.
            </p>

            <div className="mt-8 w-full max-w-lg text-left space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={15} className="text-rose-400 shrink-0" aria-hidden="true" />
                <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                  Rejection Details &mdash; {KYC_REJECTION_REASONS.length} issue{KYC_REJECTION_REASONS.length !== 1 ? 's' : ''} found
                </h4>
              </div>

              {KYC_REJECTION_REASONS.map((reason) => (
                <div
                  key={reason.code}
                  className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4"
                  role="listitem"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          reason.severity === 'high'
                            ? 'bg-rose-500/25 text-rose-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {reason.code}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-rose-200">{reason.field}</p>
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          {CATEGORY_ICON[reason.category]}
                          {reason.category}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                        {reason.description}
                      </p>
                      <p className="mt-2 text-xs text-slate-500 leading-relaxed flex items-start gap-1.5">
                        <span className="text-primary font-semibold shrink-0">Fix:</span>
                        {reason.action}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 flex w-full max-w-lg flex-col gap-4 sm:flex-row">
              <button
                onClick={() => setKycState('not_started')}
                className="action-button flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-8 py-3 text-sm font-medium text-white shadow-lg shadow-rose-500/20 hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50 sm:flex-none"
              >
                <RefreshCw size={16} aria-hidden="true" />
                Resubmit KYC
              </button>
              <a
                href={`mailto:${uiConfig.supportEmail || 'support@example.com'}`}
                className="action-button flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-8 py-3 text-sm font-medium text-slate-300 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50 sm:flex-none"
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
