import { useState, useId } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { FieldRequirement } from '../types';

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
}

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
const BANK_ACCOUNT_PATTERN = /^\d{6,20}$/;
const WALLET_PATTERN = /^G[A-Z0-9]{55}$/;

const getFieldType = (key: string): React.HTMLInputTypeAttribute => {
  if (key.toLowerCase().includes('amount')) return 'number';
  if (key.toLowerCase().includes('email')) return 'email';
  return 'text';
};

const validateField = (field: FieldRequirement, value: string): string => {
  const trimmed = value.trim();

  if (field.required && !trimmed) {
    return `${field.label} is required.`;
  }

  if (!trimmed) return '';

  const key = field.key.toLowerCase();

  if (key.includes('amount')) {
    if (!AMOUNT_PATTERN.test(trimmed)) {
      return 'Enter a valid amount (e.g. 120.50).';
    }
    const num = parseFloat(trimmed);
    if (num <= 0) return 'Amount must be greater than zero.';
    if (num > 1_000_000) return 'Amount exceeds the maximum single-transaction limit.';
  }

  if (key.includes('bankaccount') || key.includes('bank_account') || key.includes('account')) {
    if (!BANK_ACCOUNT_PATTERN.test(trimmed)) {
      return 'Bank account must be 6–20 digits.';
    }
  }

  if (key.includes('wallet') || key.includes('address')) {
    if (!WALLET_PATTERN.test(trimmed)) {
      return 'Enter a valid Stellar wallet address starting with G.';
    }
  }

  return '';
};

const validateAll = (fields: FieldRequirement[], values: FormValues): FieldError => {
  const errors: FieldError = {};
  for (const field of fields) {
    const err = validateField(field, values[field.key] ?? '');
    if (err) errors[field.key] = err;
  }
  return errors;
};

export const WithdrawalForm = ({ fields, onSubmit }: WithdrawalFormProps) => {
  const formId = useId();
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  );
  const [errors, setErrors] = useState<FieldError>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (touched[key]) {
      const field = fields.find((f) => f.key === key)!;
      const err = validateField(field, value);
      setErrors((prev) => ({ ...prev, [key]: err }));
    }
  };

  const handleBlur = (key: string) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    const field = fields.find((f) => f.key === key)!;
    const err = validateField(field, values[key] ?? '');
    setErrors((prev) => ({ ...prev, [key]: err }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const allTouched = Object.fromEntries(fields.map((f) => [f.key, true]));
    setTouched(allTouched);

    const allErrors = validateAll(fields, values);
    setErrors(allErrors);

    if (Object.keys(allErrors).length === 0) {
      onSubmit(values);
    }
  };

  const hasErrors = Object.values(errors).some(Boolean);
  const errorCount = Object.values(errors).filter(Boolean).length;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label="Withdrawal form"
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
            Please fix {errorCount} error{errorCount !== 1 ? 's' : ''} before continuing.
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
                  Required
                </span>
              ) : (
                <span className="text-xs font-normal text-slate-500" aria-hidden="true">
                  Optional
                </span>
              )}
            </label>

            {field.helpText && (
              <p id={hintId} className="text-xs text-slate-500">
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

      <button
        type="submit"
        className="btn-primary w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        Continue to Verification
      </button>
    </form>
  );
};

export default WithdrawalForm;
