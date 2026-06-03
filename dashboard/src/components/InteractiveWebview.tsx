import { useState } from 'react';
import { ShieldCheck, ExternalLink, Lock, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type WebviewState = 'idle' | 'loading' | 'active' | 'approved' | 'rejected';

interface InteractiveWebviewProps {
  /** The anchor brand name shown in the security header */
  anchorName: string;
  /** The SEP-24 interactive URL that would be loaded in production */
  interactiveUrl?: string;
  /** Called when the user approves/completes the webview flow */
  onComplete: () => void;
  /** Called when the user dismisses/rejects the webview flow */
  onDismiss?: () => void;
  /** Title shown above the webview panel */
  title?: string;
}

const SIMULATED_STEPS = [
  { label: 'Establishing secure channel…', duration: 800 },
  { label: 'Loading anchor KYC flow…',     duration: 900 },
  { label: 'Rendering interactive form…',  duration: 700 },
];

export const InteractiveWebview = ({
  anchorName,
  interactiveUrl,
  onComplete,
  onDismiss,
  title = 'Anchor Interactive Flow',
}: InteractiveWebviewProps) => {
  const [webviewState, setWebviewState] = useState<WebviewState>('idle');
  const [loadStep, setLoadStep] = useState(0);
  const [simulatedField, setSimulatedField] = useState('');

  const handleLaunch = () => {
    setWebviewState('loading');
    setLoadStep(0);

    SIMULATED_STEPS.forEach((step, i) => {
      const delay = SIMULATED_STEPS.slice(0, i).reduce((acc, s) => acc + s.duration, 0);
      setTimeout(() => setLoadStep(i + 1), delay + step.duration);
    });

    const total = SIMULATED_STEPS.reduce((acc, s) => acc + s.duration, 0);
    setTimeout(() => setWebviewState('active'), total);
  };

  const handleApprove = () => {
    setWebviewState('approved');
    setTimeout(() => onComplete(), 1200);
  };

  const handleReject = () => {
    setWebviewState('rejected');
    onDismiss?.();
  };

  return (
    <div className="space-y-3">
      {/* Security header */}
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
        <Lock size={13} className="text-emerald-400 shrink-0" aria-hidden="true" />
        <p className="text-xs text-emerald-300">
          Secure SEP-24 session — content served by {anchorName}
        </p>
        {interactiveUrl && (
          <a
            href={interactiveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-emerald-400 hover:underline inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 rounded"
            aria-label={`Open ${anchorName} interactive flow in a new tab`}
          >
            Open in tab <ExternalLink size={11} aria-hidden="true" />
          </a>
        )}
      </div>

      {/* Webview panel */}
      <div
        className="relative aspect-video rounded-xl border border-slate-700 bg-slate-950 overflow-hidden"
        role="region"
        aria-label={`${title} interactive panel`}
        aria-live="polite"
        aria-busy={webviewState === 'loading'}
      >
        <AnimatePresence mode="wait">

          {/* Idle state */}
          {webviewState === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck size={32} className="text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-slate-200">{anchorName} Secure Portal</p>
                <p className="mt-1 text-sm text-slate-500">
                  Complete your identity verification through the anchor's interactive flow.
                </p>
              </div>
              <button
                onClick={handleLaunch}
                className="btn-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                aria-label={`Launch ${anchorName} KYC portal`}
              >
                Launch KYC Portal
              </button>
            </motion.div>
          )}

          {/* Loading state */}
          {webviewState === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-6"
            >
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-primary" aria-hidden="true" />
              <div className="space-y-2 text-center">
                {SIMULATED_STEPS.map((step, i) => (
                  <p
                    key={step.label}
                    className={`text-sm transition-colors ${
                      i < loadStep ? 'text-emerald-400' : i === loadStep ? 'text-slate-300' : 'text-slate-600'
                    }`}
                  >
                    {i < loadStep ? '✓ ' : ''}{step.label}
                  </p>
                ))}
              </div>
            </motion.div>
          )}

          {/* Active / form state */}
          {webviewState === 'active' && (
            <motion.div
              key="active"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col"
            >
              {/* Simulated browser chrome */}
              <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2">
                <div className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
                </div>
                <div className="flex flex-1 items-center gap-2 rounded bg-slate-800 px-3 py-1">
                  <Lock size={10} className="text-emerald-400 shrink-0" aria-hidden="true" />
                  <span className="text-xs text-slate-400 truncate">
                    {interactiveUrl ?? `https://kyc.${anchorName.toLowerCase().replace(/\s+/g, '')}.example/sep24`}
                  </span>
                </div>
              </div>

              {/* Simulated KYC form content */}
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
                <p className="text-sm font-semibold text-slate-200">{anchorName} — Identity Verification</p>
                <div className="w-full max-w-xs space-y-3">
                  <div>
                    <label htmlFor="webview-fullname" className="mb-1 block text-xs text-slate-400">
                      Full Name
                    </label>
                    <input
                      id="webview-fullname"
                      type="text"
                      placeholder="Jane Doe"
                      value={simulatedField}
                      onChange={(e) => setSimulatedField(e.target.value)}
                      className="input-field w-full text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                    <AlertTriangle size={12} className="text-amber-400 shrink-0" aria-hidden="true" />
                    <p className="text-[11px] text-amber-300">
                      Demo mode — no real data is collected.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleReject}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 transition-all hover:border-rose-500/40 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
                    aria-label="Cancel KYC verification"
                  >
                    <X size={14} aria-hidden="true" /> Cancel
                  </button>
                  <button
                    onClick={handleApprove}
                    className="btn-primary text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    aria-label="Submit KYC and continue"
                  >
                    Submit &amp; Continue
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Approved state */}
          {webviewState === 'approved' && (
            <motion.div
              key="approved"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2 size={36} className="text-emerald-400" aria-hidden="true" />
              </div>
              <p className="font-medium text-emerald-300">Verification Approved</p>
              <p className="text-sm text-slate-500">Continuing to next step…</p>
            </motion.div>
          )}

          {/* Rejected state */}
          {webviewState === 'rejected' && (
            <motion.div
              key="rejected"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10">
                <X size={36} className="text-rose-400" aria-hidden="true" />
              </div>
              <p className="font-medium text-rose-300">Verification Cancelled</p>
              <button
                onClick={() => setWebviewState('idle')}
                className="text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
              >
                Try again
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
};

export default InteractiveWebview;
