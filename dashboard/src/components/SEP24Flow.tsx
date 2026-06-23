import { useState } from 'react';
import { ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { RequirementList } from './RequirementList';
import { WithdrawalForm } from './WithdrawalForm';
import { InteractiveWebview } from './InteractiveWebview';
import type { UiConfig } from '../types';

const STEP_LABELS = [
  'Select Asset',
  'Fill Details',
  'Identity Verification',
  'Transaction Complete',
] as const;

// Deposit keeps a 3-step flow; withdrawal adds a form step (step 2).
const DEPOSIT_STEPS = [1, 3, 4] as const;
const WITHDRAW_STEPS = [1, 2, 3, 4] as const;

export const SEP24Flow = ({ type, uiConfig }: { type: 'deposit' | 'withdraw'; uiConfig: UiConfig }) => {
  const [step, setStep] = useState(1);
  const transactionFields = uiConfig.fieldRequirements[type];
  const flowLabel = type === 'deposit' ? 'Deposit' : 'Withdrawal';

  // For display, map logical step to the label index
  const isWithdraw = type === 'withdraw';
  const visibleSteps = isWithdraw ? WITHDRAW_STEPS : DEPOSIT_STEPS;
  const totalSteps = visibleSteps.length;
  const currentStepIndex = visibleSteps.indexOf(step as never);
  const displayStep = currentStepIndex + 1;

  const goToStep = (s: number) => setStep(s);

  return (
    <div className="mx-auto max-w-4xl glass-card p-6 sm:p-8">
      {/* Live region announces step changes to screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {`Step ${displayStep} of ${totalSteps}: ${STEP_LABELS[step - 1]}`}
      </div>

      {/* Step indicator */}
      <nav
        className="mb-12 relative px-4"
        aria-label={`${flowLabel} progress`}
      >
        {/* Progress track background */}
        <div className="absolute top-5 left-10 right-10 h-0.5 bg-slate-600 -translate-y-1/2 z-0" aria-hidden="true">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
            style={{ width: totalSteps > 1 ? `${((displayStep - 1) / (totalSteps - 1)) * 100}%` : '0%' }}
          />
        </div>

        <ol className="relative z-10 flex justify-between list-none p-0 m-0 w-full">
          {visibleSteps.map((s, idx) => {
            const isCompleted = step > s;
            const isActive = step === s;
            const isFuture = step < s;
            return (
              <li key={s} className="flex flex-col items-center flex-1">
                <button
                  type="button"
                  onClick={() => {
                    if (!isFuture) {
                      goToStep(s);
                    }
                  }}
                  disabled={isFuture}
                  className={`flex h-10 w-10 items-center justify-center rounded-full font-bold transition-all duration-300 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                    isCompleted
                      ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-lg shadow-primary/30 scale-105 hover:scale-110 cursor-pointer'
                    : isActive
                      ? 'bg-slate-900 border-2 border-primary text-primary-text shadow-lg shadow-primary/20 scale-110 ring-4 ring-primary/20 cursor-default'
                      : 'bg-slate-950 border border-slate-600 text-slate-400 cursor-not-allowed'
                  }`}
                  aria-label={`Step ${idx + 1} of ${totalSteps}: ${STEP_LABELS[s - 1]}${
                    isActive ? ' (current)' : isCompleted ? ' (completed)' : ''
                  }`}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isCompleted ? (
                    <CheckCircle2 size={16} className="text-primary-foreground" aria-hidden="true" />
                  ) : (
                    <span aria-hidden="true">{idx + 1}</span>
                  )}
                </button>
                <span
                  className={`mt-3 text-xs font-semibold tracking-wide transition-colors duration-300 text-center ${
                    isActive ? 'text-primary-text' : isCompleted ? 'text-slate-300' : 'text-slate-400'
                  }`}
                >
                  {STEP_LABELS[s - 1]}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      <AnimatePresence mode="wait">

        {/* Step 1 — Asset selection (both deposit and withdrawal) */}
        {step === 1 && (
          <motion.div
            key="step-select-asset"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"
          >
            <div className="space-y-4">
              <h2 className="font-display text-2xl font-bold">{flowLabel} Assets</h2>
              <p className="text-slate-400">
                The anchor is supplying the field requirements for this flow from the backend configuration.
              </p>
              <ul
                className="grid grid-cols-1 gap-3 p-0 m-0 list-none"
                aria-label={`Available assets for ${flowLabel.toLowerCase()}`}
              >
                {(['USDC', 'EURT', 'ARST'] as const).map((asset) => (
                  <li key={asset}>
                    <button
                      onClick={() => goToStep(isWithdraw ? 2 : 3)}
                      className="flex w-full items-center justify-between rounded-xl border border-slate-500 bg-slate-900 p-4 transition-all hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 font-bold text-primary-text"
                          aria-hidden="true"
                        >
                          {asset[0]}
                        </div>
                        <span>{asset}</span>
                      </div>
                      <ArrowUpRight size={18} className="text-slate-400" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <RequirementList
              title={`${flowLabel} Requirements`}
              fields={transactionFields}
            />
          </motion.div>
        )}

        {/* Step 2 — Withdrawal details form (withdrawal only) */}
        {step === 2 && isWithdraw && (
          <motion.div
            key="step-withdrawal-form"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"
          >
            <div className="space-y-4">
              <h2 className="font-display text-2xl font-bold">Withdrawal Details</h2>
              <p className="text-slate-400">
                All fields are validated before proceeding. Required fields are marked accordingly.
              </p>
              <WithdrawalForm
                fields={transactionFields}
                onSubmit={() => goToStep(3)}
              />
              <button
                onClick={() => goToStep(1)}
                className="text-sm text-slate-400 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text rounded"
              >
                ← Back to asset selection
              </button>
            </div>
            <RequirementList
              title="Withdrawal Requirements"
              fields={transactionFields}
            />
          </motion.div>
        )}

        {/* Step 3 — Identity Verification (KYC interactive webview) */}
        {step === 3 && (
          <motion.div
            key="step-kyc"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"
          >
            <div className="space-y-4">
              <h2 className="font-display text-2xl font-bold">Identity Verification</h2>
              <p className="text-slate-400">
                KYC requirements are backend-driven, so each anchor can tighten or relax the form without redeploying the dashboard.
              </p>
              <InteractiveWebview
                anchorName={uiConfig.brandName}
                onComplete={() => goToStep(4)}
                onDismiss={() => goToStep(isWithdraw ? 2 : 1)}
                title="SEP-24 KYC Webview"
              />
            </div>
            <RequirementList title="KYC Requirements" fields={uiConfig.fieldRequirements.kyc} />
          </motion.div>
        )}

        {/* Step 4 — Transaction complete */}
        {step === 4 && (
          <motion.div
            key="step-complete"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="py-12 text-center"
          >
            <div
              className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500"
              role="img"
              aria-label="Transaction submitted successfully"
            >
              <CheckCircle2 size={40} aria-hidden="true" />
            </div>
            <h2 className="mb-2 font-display text-3xl font-bold">Transaction Initiated</h2>
            <p className="mb-8 text-slate-400">
              Your {flowLabel.toLowerCase()} request has been submitted with {uiConfig.brandName} branding and field
              rules pulled from the backend.
            </p>
            <button
              onClick={() => goToStep(1)}
              className="font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
            >
              Back to Dashboard
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default SEP24Flow;
