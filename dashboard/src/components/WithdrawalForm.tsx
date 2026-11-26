import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Calculator } from 'lucide-react';
import type { FieldRequirement } from '../types';
import { validateField, validateAll } from '../lib/validation';
import { useTranslation } from '../i18n/config';
import { computePayoutBreakdown, fetchFeeEstimate } from '../lib/fees';
import type { FeeEstimate } from '../lib/fees';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

interface FormValues {
  [key: string]: string;
}

interface FieldError {
  [key: string]: string;
}

interface WithdrawalFormProps {
  /** Field definitions driven by the backend UiConfig */
  fields: FieldRequirement[];
  /** Called with validated form values when the user submits */
  onSubmit: (values: FormValues) => void;
  /** Asset code being withdrawn (e.g. 'USDC'). Used for fee estimation. */
  assetCode?: string;
  /** Base URL of the anchor API used for fee estimation. */
  apiBaseUrl?: string;
  /** Optional fee estimator override (used in tests / alternate backends). */
  onEstimateFee?: (params: { assetCode: string; amount: string }) => Promise<FeeEstimate>;
}

const FEE_DEBOUNCE_MS = 300;

type FeeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; estimate: FeeEstimate }
  | { status: 'error'; message: string };

const getFieldType = (key: string): React.HTMLInputTypeAttribute => {
  if (key.toLowerCase().includes('amount')) return 'number';
  if (key.toLowerCase().includes('email')) return 'email';
  return 'text';
};

const formatMoney = (value: number): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export const WithdrawalForm = ({
  fields,
  onSubmit,
  assetCode,
  apiBaseUrl = 'http://localhost:3002',
  onEstimateFee,
}: WithdrawalFormProps) => {
  const formId = useId();
  const { t } = useTranslation();
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  );
  const [errors, setErrors] = useState<FieldError>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [feeState, setFeeState] = useState<FeeState>({ status: 'idle' });

  const amountField = useMemo(
    () => fields.find((f) => f.key.toLowerCase().includes('amount')),
    [fields],
  );
  const amountKey = amountField?.key;
  const amountValue = amountKey ? (values[amountKey] ?? '') : '';

  const estimateFee = useCallback(
    (params: { assetCode: string; amount: string }) => {
      if (onEstimateFee) return onEstimateFee(params);
      return fetchFeeEstimate(apiBaseUrl, params.assetCode, params.amount);
    },
    [onEstimateFee, apiBaseUrl],
  );

  // Debounced fee estimation triggered by amount changes.
  useEffect(() => {
    if (!amountKey || !assetCode) {
      setFeeState({ status: 'idle' });
      return;
    }

    const trimmed = amountValue.trim();
    const amount = parseFloat(trimmed);

    if (!trimmed || !Number.isFinite(amount) || amount <= 0) {
      setFeeState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setFeeState({ status: 'loading' });

    const timer = setTimeout(() => {
      estimateFee({ assetCode, amount: trimmed })
        .then((estimate) => {
          if (!cancelled) setFeeState({ status: 'success', estimate });
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setFeeState({
              status: 'error',
              message: err instanceof Error ? err.message : 'Unable to estimate fee.',
            });
          }
        });
    }, FEE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amountValue, amountKey, assetCode, estimateFee]);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (touched[key]) {
      const field = fields.find((f) => f.key === key)!;
      const err = validateField(field, value, t);
      setErrors((prev) => ({ ...prev, [key]: err }));
    }
  };

  const handleBlur = (key: string) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    const field = fields.find((f) => f.key === key)!;
    const err = validateField(field, values[key] ?? '', t);
    setErrors((prev) => ({ ...prev, [key]: err }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const allTouched = Object.fromEntries(fields.map((f) => [f.key, true]));
    setTouched(allTouched);

    const allErrors = validateAll(fields, values, t);
    setErrors(allErrors);

    if (Object.keys(allErrors).length === 0) {
      onSubmit(values);
    }
  };

  const hasErrors = Object.values(errors).some(Boolean);
  const errorCount = Object.values(errors).filter(Boolean).length;

  const parsedAmount = parseFloat(amountValue);
  const breakdown =
    feeState.status === 'success' && Number.isFinite(parsedAmount)
      ? computePayoutBreakdown(parsedAmount, feeState.estimate)
      : null;
  const netPayout = breakdown?.netPayout ?? null;
  const { isOnline } = useNetworkStatus();
  const disableSubmit = !isOnline || (netPayout !== null && netPayout <= 0);

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={t('withdraw.formAriaLabel')}
      className="space-y-5"
    >
      {/* Summary error alert shown after first submit attempt */}
      {submitted && hasErrors && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-400" aria-hidden="true" />
          <p className="text-sm text-rose-300">
            {t('withdraw.errors.inlineSummary', {
              count: errorCount,
              s: errorCount !== 1 ? 's' : '',
            })}
          </p>
        </div>
      )}

      {fields.map((field) => {
        const inputId = `${formId}-${field.key}`;
        const errorId = `${formId}-${field.key}-error`;
        const hintId = field.helpText ? `${formId}-${field.key}-hint` : undefined;
        const err = errors[field.key];
        const isInvalid = touched[field.key] && Boolean(err);

        return (
          <div key={field.key} className="space-y-1.5">
            <label
              htmlFor={inputId}
              className="flex items-center gap-2 text-sm font-medium text-slate-300"
            >
              {field.label}
              {field.required ? (
                <span className="text-xs font-normal text-amber-400" aria-hidden="true">
                  {t('withdraw.required')}
                </span>
              ) : (
                <span className="text-xs font-normal text-slate-400" aria-hidden="true">
                  {t('withdraw.optional')}
                </span>
              )}
            </label>

            {field.helpText && (
              <p id={hintId} className="text-xs text-slate-400">
                {field.helpText}
              </p>
            )}

            <div className="relative">
              <input
                id={inputId}
                type={getFieldType(field.key)}
                value={values[field.key] ?? ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
                onBlur={() => handleBlur(field.key)}
                placeholder={field.placeholder}
                required={field.required}
                aria-required={field.required}
                aria-invalid={isInvalid}
                aria-describedby={
                  [errorId, hintId].filter(Boolean).join(' ') || undefined
                }
                className={`input-field w-full pr-9 text-sm transition-all ${
                  isInvalid
                    ? 'border-rose-500/60 focus:ring-rose-500/40'
                    : touched[field.key] && !err
                    ? 'border-emerald-500/40 focus:ring-emerald-500/30'
                    : ''
                }`}
              />
              {touched[field.key] && !err && values[field.key] && (
                <CheckCircle2
                  size={15}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400"
                  aria-hidden="true"
                />
              )}
              {isInvalid && (
                <AlertCircle
                  size={15}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-rose-400"
                  aria-hidden="true"
                />
              )}
            </div>

            {isInvalid && (
              <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs text-rose-400">
                <AlertCircle size={11} aria-hidden="true" />
                {err}
              </p>
            )}
          </div>
        );
      })}

      {/* Dynamic fee summary breakdown */}
      {amountKey && (
        <div
          data-testid="fee-summary"
          aria-live="polite"
          className="rounded-xl border border-slate-700/80 bg-slate-900/60 p-4"
        >
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Calculator size={15} className="text-primary" aria-hidden="true" />
            Fee Summary
          </h3>

          {feeState.status === 'loading' ? (
            <p className="text-xs text-slate-400">Estimating fees…</p>
          ) : feeState.status === 'error' ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-400" role="alert">
              <AlertCircle size={12} aria-hidden="true" />
              {feeState.message}
            </p>
          ) : breakdown ? (
            <>
              <dl className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400">Amount</dt>
                  <dd data-testid="fee-amount" className="font-medium text-slate-200">
                    {formatMoney(breakdown.amount)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400">Fixed Fee</dt>
                  <dd data-testid="fee-fixed" className="font-medium text-rose-300">
                    -{formatMoney(breakdown.fixedFee)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400">% Fee</dt>
                  <dd data-testid="fee-percent" className="font-medium text-rose-300">
                    -{formatMoney(breakdown.percentFee)}
                  </dd>
                </div>
                <div className="my-1 border-t border-slate-700/70" />
                <div className="flex items-center justify-between">
                  <dt className="font-semibold text-slate-300">You Receive</dt>
                  <dd data-testid="fee-net" className="font-semibold text-emerald-400">
                    {formatMoney(breakdown.netPayout)}
                  </dd>
                </div>
              </dl>

              {disableSubmit && (
                <p
                  className="mt-3 flex items-center gap-1.5 text-xs text-rose-400"
                  role="alert"
                >
                  <AlertCircle size={12} aria-hidden="true" />
                  Amount after fees is zero or negative. Increase the amount to continue.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-400">Enter an amount to preview fees.</p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={disableSubmit}
        aria-disabled={disableSubmit}
        title={!isOnline ? 'No internet connection — submission disabled' : undefined}
        className="btn-primary w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('withdraw.submit')}
      </button>
    </form>
  );
};

export default WithdrawalForm;
