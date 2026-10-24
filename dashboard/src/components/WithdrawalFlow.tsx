import { useState } from 'react';
import { ArrowUpRight, CheckCircle2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { RequirementList } from './RequirementList';
import { WithdrawalForm } from './WithdrawalForm';
import { DepositErrorAlert } from './DepositErrorAlert';
import { InteractiveWebview } from './InteractiveWebview';
import { AssetDropdown } from './AssetDropdown';
import type { AssetOption } from './AssetDropdown';
import type { DepositError } from './DepositErrorAlert';
import type { FeeEstimate } from '../lib/fees';
import type { UiConfig } from '../types';

export const WITHDRAWAL_STEP_LABELS = ['Select Asset', 'Amount', 'Anchor Webview', 'Confirmation'] as const;

export const WITHDRAWAL_ASSET_OPTIONS: AssetOption[] = [
  { code: 'USDC', name: 'USD Coin', subtitle: 'Dollar-backed liquidity for institutional settlement' },
  { code: 'EURT', name: 'Euro Token', subtitle: 'Euro-denominated transfer rail for SEP-24 flows' },
  { code: 'ARST', name: 'ARS Token', subtitle: 'Argentine peso corridor asset for local payouts' },
];

export interface WithdrawInteractiveRequest {
  asset_code: string;
  amount?: string;
  account?: string;
  dest?: string;
  dest_extra?: string;
  lang?: string;
}

export interface WithdrawInteractiveResponse {
  type: string;
  url: string;
  id: string;
  expires_at?: string;
}

/** Error raised by `requestWithdrawInteractive`, carrying the HTTP status when one was received. */
export class WithdrawRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'WithdrawRequestError';
  }
}

/** POST /sep24/transactions/withdraw/interactive */
export const requestWithdrawInteractive = async (
  apiBaseUrl: string,
  body: WithdrawInteractiveRequest,
): Promise<WithdrawInteractiveResponse> => {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/sep24/transactions/withdraw/interactive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new WithdrawRequestError('Unable to reach the anchor.');
  }

  const payload = (await response.json().catch(() => ({}))) as Partial<WithdrawInteractiveResponse> & {
    error?: string;
  };
  if (!response.ok) {
    throw new WithdrawRequestError(payload.error ?? `Request failed with status ${response.status}`, response.status);
  }
  if (!payload.url || !payload.id) {
    throw new WithdrawRequestError('The anchor returned an incomplete interactive response.', response.status);
  }
  return payload as WithdrawInteractiveResponse;
};

/** Maps a failed withdraw request onto the shared DepositErrorAlert shape. */
export const toWithdrawalError = (err: unknown): DepositError => {
  const status = err instanceof WithdrawRequestError ? err.status : undefined;
  const message = err instanceof Error ? err.message : 'Something went wrong.';

  if (status === undefined) {
    return {
      type: 'network',
      title: 'Network Error',
      message: 'We could not reach the anchor to start your withdrawal.',
      details: message,
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      type: 'server',
      title: 'Anchor Unavailable',
      message: 'The anchor could not start your withdrawal right now.',
      details: message,
      retryable: true,
    };
  }
  if (/not supported/i.test(message)) {
    return {
      type: 'asset',
      title: 'Asset Not Supported',
      message: 'This anchor does not support withdrawals for the selected asset.',
      details: message,
      retryable: false,
    };
  }
  return {
    type: 'validation',
    title: 'Withdrawal Rejected',
    message: 'The anchor rejected the withdrawal request.',
    details: message,
    retryable: false,
  };
};

interface WithdrawalFlowProps {
  uiConfig: UiConfig;
  apiBaseUrl?: string;
  /** Stellar account initiating the withdrawal, forwarded to the anchor. */
  account?: string;
  /** Override for the interactive request (used in tests / alternate backends). */
  onRequestInteractive?: (body: WithdrawInteractiveRequest) => Promise<WithdrawInteractiveResponse>;
  /** Override for fee estimation on the amount step. */
  onEstimateFee?: (params: { assetCode: string; amount: string }) => Promise<FeeEstimate>;
}

type FormValues = Record<string, string>;

const stepMotion = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

export const WithdrawalFlow = ({
  uiConfig,
  apiBaseUrl = 'http://localhost:3002',
  account,
  onRequestInteractive,
  onEstimateFee,
}: WithdrawalFlowProps) => {
  const [step, setStep] = useState(1);
  const [selectedAsset, setSelectedAsset] = useState(WITHDRAWAL_ASSET_OPTIONS[0].code);
  const [formValues, setFormValues] = useState<FormValues | null>(null);
  const [interactive, setInteractive] = useState<WithdrawInteractiveResponse | null>(null);
  const [error, setError] = useState<DepositError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fields = uiConfig.fieldRequirements.withdraw;
  const amountKey = fields.find((f) => f.key.toLowerCase().includes('amount'))?.key ?? 'amount';
  const totalSteps = WITHDRAWAL_STEP_LABELS.length;

  const goToStep = (s: number) => {
    setStep(s);
    setError(null);
  };

  const startInteractive = async (values: FormValues) => {
    setFormValues(values);
    setError(null);
    setSubmitting(true);
    const body: WithdrawInteractiveRequest = {
      asset_code: selectedAsset,
      amount: values[amountKey] || undefined,
      account,
      dest: Object.entries(values).find(([key, value]) => key !== amountKey && value)?.[1],
    };
    try {
      const response = onRequestInteractive
        ? await onRequestInteractive(body)
        : await requestWithdrawInteractive(apiBaseUrl, body);
      setInteractive(response);
      setStep(3);
    } catch (err) {
      setError(toWithdrawalError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleWebviewDismiss = () => {
    setError({
      type: 'kyc',
      title: 'Withdrawal Not Completed',
      message: 'The anchor webview was closed before the withdrawal was confirmed.',
      details: 'Relaunch the anchor flow to finish your withdrawal.',
      retryable: true,
    });
  };

  const reset = () => {
    setFormValues(null);
    setInteractive(null);
    goToStep(1);
  };

  return (
    <div data-testid="withdrawal-flow">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {`Step ${step} of ${totalSteps}: ${WITHDRAWAL_STEP_LABELS[step - 1]}`}
      </div>

      <nav className="mb-10" aria-label="Withdrawal progress">
        <ol className="m-0 grid list-none grid-cols-4 gap-2 p-0">
          {WITHDRAWAL_STEP_LABELS.map((label, idx) => {
            const s = idx + 1;
            const isCompleted = step > s;
            const isActive = step === s;
            return (
              <li
                key={label}
                aria-current={isActive ? 'step' : undefined}
                className="flex flex-col items-center gap-2 text-center"
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                    isCompleted
                      ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground'
                      : isActive
                        ? 'border-2 border-primary bg-slate-900 text-primary'
                        : 'border border-slate-800 bg-slate-950 text-slate-600'
                  }`}
                  aria-hidden="true"
                >
                  {isCompleted ? <CheckCircle2 size={16} /> : s}
                </span>
                <span
                  className={`text-xs font-semibold ${
                    isActive ? 'text-primary' : isCompleted ? 'text-slate-300' : 'text-slate-500'
                  }`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="withdraw-asset" {...stepMotion} className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <h2 className="font-display text-2xl font-bold">Withdrawal Assets</h2>
              <p className="text-slate-400">Choose the asset you want to withdraw from your Stellar account.</p>
              <AssetDropdown
                label="Withdrawal asset"
                options={WITHDRAWAL_ASSET_OPTIONS}
                value={selectedAsset}
                onChange={setSelectedAsset}
              />
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="btn-primary inline-flex w-full items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:w-auto"
              >
                Continue with {selectedAsset}
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </div>
            <RequirementList title="Withdrawal Requirements" fields={fields} />
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="withdraw-amount" {...stepMotion} className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <h2 className="font-display text-2xl font-bold">Withdrawal Amount</h2>
              <p className="text-slate-400">
                Enter how much {selectedAsset} to withdraw. The anchor will open a secure webview to collect the rest.
              </p>
              <DepositErrorAlert
                error={error}
                onDismiss={() => setError(null)}
                onRetry={formValues ? () => void startInteractive(formValues) : undefined}
                dismissible={true}
              />
              {submitting && (
                <p role="status" className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  Requesting interactive session…
                </p>
              )}
              <WithdrawalForm
                fields={fields}
                assetCode={selectedAsset}
                apiBaseUrl={apiBaseUrl}
                onEstimateFee={onEstimateFee}
                onSubmit={(values) => void startInteractive(values)}
              />
              <button
                type="button"
                onClick={() => goToStep(1)}
                className="rounded text-sm text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                ← Back to asset selection
              </button>
            </div>
            <RequirementList title="Withdrawal Requirements" fields={fields} />
          </motion.div>
        )}

        {step === 3 && interactive && (
          <motion.div key="withdraw-webview" {...stepMotion} className="space-y-4">
            <h2 className="font-display text-2xl font-bold">Complete Withdrawal with {uiConfig.brandName}</h2>
            <p className="text-slate-400">
              The anchor hosts the rest of this withdrawal. Finish the steps in the webview to confirm the payout.
            </p>
            <DepositErrorAlert error={error} onDismiss={() => setError(null)} dismissible={true} />
            <InteractiveWebview
              anchorName={uiConfig.brandName}
              interactiveUrl={interactive.url}
              onComplete={() => goToStep(4)}
              onDismiss={handleWebviewDismiss}
              title="SEP-24 Withdrawal Webview"
            />
            <button
              type="button"
              onClick={() => goToStep(2)}
              className="rounded text-sm text-slate-500 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              ← Back to amount
            </button>
          </motion.div>
        )}

        {step === 4 && (
          <motion.div
            key="withdraw-confirmation"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="py-10 text-center"
          >
            <div
              className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-500"
              role="img"
              aria-label="Withdrawal submitted successfully"
            >
              <CheckCircle2 size={40} aria-hidden="true" />
            </div>
            <h2 className="mb-2 font-display text-3xl font-bold">Withdrawal Submitted</h2>
            <p className="mb-6 text-slate-400">
              {uiConfig.brandName} is processing your {selectedAsset} withdrawal.
            </p>
            <dl className="mx-auto mb-8 max-w-sm space-y-2 rounded-xl border border-slate-700/80 bg-slate-900/60 p-4 text-left text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Asset</dt>
                <dd className="font-medium text-slate-200">{selectedAsset}</dd>
              </div>
              {formValues?.[amountKey] && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Amount</dt>
                  <dd className="font-medium text-slate-200">{formValues[amountKey]}</dd>
                </div>
              )}
              {interactive && (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Transaction ID</dt>
                  <dd data-testid="withdrawal-transaction-id" className="break-all font-mono text-xs text-slate-200">
                    {interactive.id}
                  </dd>
                </div>
              )}
            </dl>
            <button
              type="button"
              onClick={reset}
              className="font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
            >
              Start another withdrawal
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default WithdrawalFlow;
