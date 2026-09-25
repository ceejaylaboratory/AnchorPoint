import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ExternalLink, Lock, AlertTriangle, CheckCircle2, X, Maximize, Minimize } from 'lucide-react';
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

const SIMULATED_STEPS =
  process.env.NODE_ENV === 'test'
    ? [
        { label: 'Establishing secure channel…', duration: 50 },
        { label: 'Loading anchor KYC flow…', duration: 50 },
        { label: 'Rendering interactive form…', duration: 50 },
      ]
    : [
        { label: 'Establishing secure channel…', duration: 800 },
        { label: 'Loading anchor KYC flow…', duration: 900 },
        { label: 'Rendering interactive form…', duration: 700 },
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
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleFullscreenToggle = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Handle window resize to maintain proper layout
  useEffect(() => {
    const handleResize = () => {
      // No state updates needed, CSS transitions handle it smoothly
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let expectedOrigin: string | null = null;
    if (interactiveUrl) {
      try {
        expectedOrigin = new URL(interactiveUrl).origin;
      } catch (e) {
        // Invalid URL
      }
    }

    const handleMessage = (event: MessageEvent) => {
      if (expectedOrigin && event.origin !== expectedOrigin) {
        console.warn('Ignoring message from unexpected origin:', event.origin);
        return;
      }

      try {
        let data = event.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch (e) {
            // Not a JSON string
          }
        }

        if (data?.type === 'resize' || (typeof event.data === 'string' && event.data.includes('resize'))) {
          console.log('Interactive window resize message received', event.data);
        }

        if (data?.transaction?.status) {
          const status = data.transaction.status;
          if (status === 'pending_user_transfer_start' || status === 'completed') {
            setWebviewState('approved');
            setTimeout(() => onComplete(), 1200);
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [interactiveUrl, onComplete]);

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
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5">
        <Lock size={13} className="shrink-0 text-emerald-400" aria-hidden="true" />
        <p className="text-xs text-emerald-300">
          Secure SEP-24 session - content served by {anchorName}
        </p>
        {interactiveUrl && (
          <a
            href={interactiveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded text-xs text-emerald-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
            aria-label={`Open ${anchorName} interactive flow in a new tab`}
          >
            Open in tab <ExternalLink size={11} aria-hidden="true" />
          </a>
        )}
      </div>

      <motion.div
        className={`relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950 transition-all duration-300 ease-in-out ${
          isFullscreen ? 'fixed inset-4 z-50 w-[calc(100%-2rem)] h-[calc(100%-2rem)]' : 'aspect-video'
        }`}
        role="region"
        aria-label={`${title} interactive panel`}
        aria-live="polite"
        aria-busy={webviewState === 'loading'}
        layout
      >
        <AnimatePresence mode="wait">
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

          {webviewState === 'active' && (
            <motion.div
              key="active"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col"
            >
              <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2">
                <div className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
                </div>
                <div className="flex flex-1 items-center gap-2 rounded bg-slate-800 px-3 py-1">
                  <Lock size={10} className="shrink-0 text-emerald-400" aria-hidden="true" />
                  <span className="truncate text-xs text-slate-400">
                    {interactiveUrl ?? `https://kyc.${anchorName.toLowerCase().replace(/\s+/g, '')}.example/sep24`}
                  </span>
                </div>
                <button
                  onClick={handleFullscreenToggle}
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  {isFullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
                </button>
                <button
                  onClick={handleReject}
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
                  aria-label="Close webview"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
                <p className="text-sm font-semibold text-slate-200">
                  <span className="text-slate-400">{anchorName} - </span>
                  <span>Identity Verification</span>
                </p>
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
                    <AlertTriangle size={12} className="shrink-0 text-amber-400" aria-hidden="true" />
                    <p className="text-[11px] text-amber-300">
                      Demo mode - no real data is collected.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleReject}
                    className="action-button flex items-center gap-1.5 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:border-rose-500/40 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
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
              <p className="text-sm text-slate-500">Continuing to next step...</p>
            </motion.div>
          )}

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
                className="rounded text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                Try again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default InteractiveWebview;