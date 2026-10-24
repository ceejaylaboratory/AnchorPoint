import { useEffect, useId, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { RequirementList } from './RequirementList';
import { WithdrawalForm } from './WithdrawalForm';
import { DepositForm } from './DepositForm';
import { DepositErrorAlert } from './DepositErrorAlert';
import { InteractiveWebview } from './InteractiveWebview';
import { AssetDropdown } from './AssetDropdown';
import { KycDocumentUpload } from './KycDocumentUpload';
import { Modal } from './Modal';
import type { AssetOption } from './AssetDropdown';
import type { DepositError } from './DepositErrorAlert';
import type { UiConfig } from '../types';

const STEP_LABELS = ['Select Asset', 'Fill Details', 'Identity Verification', 'Transaction Complete'] as const;

const DEPOSIT_STEPS = [1, 3, 4] as const;
const WITHDRAW_STEPS = [1, 2, 3, 4] as const;

const ASSET_OPTIONS: AssetOption[] = [
  { code: 'USDC', name: 'USD Coin', subtitle: 'Dollar-backed liquidity for institutional settlement' },
  { code: 'EURT', name: 'Euro Token', subtitle: 'Euro-denominated transfer rail for SEP-24 flows' },
  { code: 'ARST', name: 'ARS Token', subtitle: 'Argentine peso corridor asset for local payouts' },
];

export const SEP24Flow = ({
  type,
  uiConfig,
  apiBaseUrl,
  account,
}: {
  type: 'deposit' | 'withdraw';
  uiConfig: UiConfig;
  apiBaseUrl?: string;
  /** Stellar account the KYC documents are uploaded for; uploads are hidden without it. */
  account?: string;
}) => {
  const [step, setStep] = useState(1);
  const [selectedAsset, setSelectedAsset] = useState(ASSET_OPTIONS[0].code);
  const [depositError, setDepositError] = useState<DepositError | null>(null);
  const [kycError, setKycError] = useState<DepositError | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const confirmTitleId = useId();
  const confirmMessageId = useId();
  const canUploadDocuments =
    Boolean(apiBaseUrl && account) && uiConfig.fieldRequirements.kyc.some((field) => field.type === 'file');
  const transactionFields = uiConfig.fieldRequirements[type];
  const flowLabel = type === 'deposit' ? 'Deposit' : 'Withdrawal';

  const isWithdraw = type === 'withdraw';
  const visibleSteps = isWithdraw ? WITHDRAW_STEPS : DEPOSIT_STEPS;
  const totalSteps = visibleSteps.length;
  const currentStepIndex = visibleSteps.indexOf(step as never);
  const displayStep = currentStepIndex + 1;

  const goToStep = (s: number) => {
    setStep(s);
    // Clear errors when navigating
    setDepositError(null);
    setKycError(null);
  };

  const handleDepositFormSubmit = () => {
    // Simulate potential deposit errors for demonstration
    // In production, this would call the backend API
    setDepositError(null);
    goToStep(4);
  };

  // Once the upload settles there is nothing left to confirm.
  useEffect(() => {
    if (!uploadInProgress) setConfirmCloseOpen(false);
  }, [uploadInProgress]);

  const closeUploadModal = () => {
    setUploadModalOpen(false);
    setConfirmCloseOpen(false);
    setUploadInProgress(false);
  };

  const documentUploadTrigger = canUploadDocuments && (
    <button
      type="button"
      onClick={() => setUploadModalOpen(true)}
      className="action-button inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <Upload size={16} aria-hidden="true" />
      Upload KYC documents
    </button>
  );

  const handleKycDismiss = () => {
    // Show error when KYC is dismissed
    setKycError({
      type: 'kyc',
      title: 'Verification Required',
      message: 'Identity verification is required to complete your deposit.',
      details: 'Please complete the KYC process to proceed.',
      retryable: true,
    });
  };

  return (
    <div className="mx-auto max-w-4xl glass-card p-6 sm:p-8">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {`Step ${displayStep} of ${totalSteps}: ${STEP_LABELS[step - 1]}`}
      </div>

      <nav className="relative mb-12 px-4" aria-label={`${flowLabel} progress`}>
        <div className="absolute left-10 right-10 top-5 z-0 h-0.5 -translate-y-1/2 bg-slate-800" aria-hidden="true">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
            style={{ width: totalSteps > 1 ? `${((displayStep - 1) / (totalSteps - 1)) * 100}%` : '0%' }}
          />
        </div>

        <ol className="relative z-10 m-0 flex w-full list-none justify-between p-0">
          {visibleSteps.map((s, idx) => {
            const isCompleted = step > s;
            const isActive = step === s;
            const isFuture = step < s;
            return (
              <li key={s} className="flex flex-1 flex-col items-center">
                <button
                  type="button"
                  onClick={() => {
                    if (!isFuture) goToStep(s);
                  }}
                  disabled={isFuture}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full font-bold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    isCompleted
                      ? 'cursor-pointer scale-105 bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-lg shadow-primary/30 hover:scale-110'
                      : isActive
                        ? 'cursor-default scale-110 border-2 border-primary bg-slate-900 text-primary shadow-lg shadow-primary/20 ring-4 ring-primary/20'
                        : 'cursor-not-allowed border border-slate-800 bg-slate-950 text-slate-600'
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
                  className={`mt-3 text-center text-xs font-semibold tracking-wide transition-colors duration-300 ${
                    isActive ? 'text-primary' : isCompleted ? 'text-slate-300' : 'text-slate-500'
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
                className="grid list-none grid-cols-1 gap-3 p-0 m-0"
                aria-label={`Available assets for ${flowLabel.toLowerCase()}`}
              >
                {(['USDC', 'EURT', 'ARST'] as const).map((asset) => (
                  <li key={asset}>
                    <button
                      onClick={() => {
                        setSelectedAsset(asset);
                        goToStep(isWithdraw ? 2 : 3);
                      }}
                      aria-label={`Select ${asset} for ${flowLabel.toLowerCase()}`}
                      className="action-button flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-900 p-4 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 font-bold text-primary"
                          aria-hidden="true"
                        >
                          {asset[0]}
                        </div>
                        <span>{asset}</span>
                      </div>
                      <ArrowUpRight size={18} className="text-slate-500" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              <AssetDropdown
                label={`${flowLabel} asset`}
                options={ASSET_OPTIONS}
                value={selectedAsset}
                onChange={setSelectedAsset}
              />
              <button
                type="button"
                onClick={() => goToStep(isWithdraw ? 2 : 3)}
                className="btn-primary inline-flex w-full items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:w-auto"
              >
                Continue with {selectedAsset}
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </div>

            <RequirementList title={`${flowLabel} Requirements`} fields={transactionFields} />
          </motion.div>
        )}

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
                assetCode={selectedAsset}
                apiBaseUrl={apiBaseUrl}
                onSubmit={() => goToStep(3)}
              />
              <button
                onClick={() => goToStep(1)}
                className="rounded text-sm text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                ← Back to asset selection
              </button>
            </div>
            <RequirementList title="Withdrawal Requirements" fields={transactionFields} />
          </motion.div>
        )}

        {step === 3 && !isWithdraw && (
          <motion.div
            key="step-deposit-details"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"
          >
            <div className="space-y-4">
              <h2 className="font-display text-2xl font-bold">Deposit Details</h2>
              <p className="text-slate-400">
                All fields are validated before proceeding. Required fields are marked accordingly.
              </p>
              <DepositErrorAlert
                error={depositError}
                onDismiss={() => setDepositError(null)}
                dismissible={true}
              />
              <DepositForm
                fields={transactionFields}
                assetCode={selectedAsset}
                onSubmit={() => handleDepositFormSubmit()}
              />
              {documentUploadTrigger}
              <button
                onClick={() => goToStep(1)}
                className="rounded text-sm text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                ← Back to asset selection
              </button>
            </div>
            <RequirementList title="Deposit Requirements" fields={transactionFields} />
          </motion.div>
        )}

        {step === 3 && isWithdraw && (
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
                KYC requirements are backend-driven, so each anchor can tighten or relax the form without redeploying
                the dashboard.
              </p>
              <DepositErrorAlert
                error={kycError}
                onDismiss={() => setKycError(null)}
                dismissible={true}
              />
              <InteractiveWebview
                anchorName={uiConfig.brandName}
                onComplete={() => goToStep(4)}
                onDismiss={() => handleKycDismiss()}
                title="SEP-24 KYC Webview"
              />
              {documentUploadTrigger}
            </div>
            <RequirementList title="KYC Requirements" fields={uiConfig.fieldRequirements.kyc} />
          </motion.div>
        )}

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
            <div className="space-y-4">
              <button
                onClick={() => goToStep(1)}
                className="font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
              >
                Back to Dashboard
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {canUploadDocuments && (
        <Modal
          isOpen={uploadModalOpen}
          title="Upload KYC Documents"
          description="Keep this window open until your documents finish uploading."
          size="lg"
          onClose={closeUploadModal}
          preventClose={uploadInProgress}
          onCloseBlocked={() => setConfirmCloseOpen(true)}
        >
          {confirmCloseOpen && (
            <div
              role="alertdialog"
              aria-labelledby={confirmTitleId}
              aria-describedby={confirmMessageId}
              className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
                <div className="space-y-1">
                  <p id={confirmTitleId} className="text-sm font-semibold text-amber-200">
                    Upload in progress
                  </p>
                  <p id={confirmMessageId} className="text-sm text-amber-100/80">
                    Closing now will discard the document that is still uploading. Do you want to close anyway?
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setConfirmCloseOpen(false)}
                  className="action-button rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
                >
                  Keep uploading
                </button>
                <button
                  type="button"
                  onClick={closeUploadModal}
                  className="action-button rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
                >
                  Close and discard upload
                </button>
              </div>
            </div>
          )}
          <KycDocumentUpload
            apiBaseUrl={apiBaseUrl as string}
            account={account as string}
            fields={uiConfig.fieldRequirements.kyc}
            onUploadingChange={setUploadInProgress}
            onComplete={closeUploadModal}
          />
        </Modal>
      )}
    </div>
  );
};

export default SEP24Flow;
