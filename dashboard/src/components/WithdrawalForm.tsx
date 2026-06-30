import { useState, useId } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { FieldRequirement } from '../types';
import { validateField, validateAll } from '../lib/validation';

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

const getFieldType = (key: string): React.HTMLInputTypeAttribute => {
  if (key.toLowerCase().includes('amount')) return 'number';
  if (key.toLowerCase().includes('email')) return 'email';
  return 'text';
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
                <span className="text-xs font-normal text-slate-400" aria-hidden="true">
                  Optional
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

      <button
        type="submit"
        className="btn-primary w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
      >
        Continue to Verification
      </button>
    </form>
  );
};

export default WithdrawalForm;
