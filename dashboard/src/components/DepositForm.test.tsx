import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldRequirement } from '../types';
import { saveBiometricSettings } from '../lib/biometricSettings';
import { I18nProvider } from '../i18n/config';
import {
  DEFAULT_ASSET_LIMITS,
  DepositForm,
  amountPattern,
  buildDepositSchema,
  getAssetLimits,
  isValidAssetCode,
  validateField,
} from './DepositForm';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      className,
      ref,
    }: {
      children?: ReactNode;
      className?: string;
      ref?: Ref<HTMLDivElement>;
    }) => (
      <div ref={ref} className={className}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const FIELDS: FieldRequirement[] = [
  { key: 'walletAddress', label: 'Wallet Address', required: true, placeholder: 'G...' },
  { key: 'amount', label: 'Amount', required: true, placeholder: '500.00' },
];

const VALID_WALLET = `G${'A'.repeat(55)}`;
const amountField = FIELDS[1];
const walletField = FIELDS[0];

afterEach(() => {
  localStorage.clear();
});

describe('asset limits', () => {
  it('returns per-asset bounds where configured', () => {
    expect(getAssetLimits('USDC')).toEqual({ min: 10, max: 100_000, decimals: 2 });
    expect(getAssetLimits('ARST').min).toBe(5_000);
  });

  it('falls back to the default bounds for an unknown asset', () => {
    expect(getAssetLimits('XYZ')).toEqual(DEFAULT_ASSET_LIMITS);
  });

  it('accepts SEP-24 alphanumeric asset codes and rejects malformed ones', () => {
    expect(isValidAssetCode('USDC')).toBe(true);
    expect(isValidAssetCode('ABCDEFGHIJKL')).toBe(true);
    expect(isValidAssetCode('usdc')).toBe(false);
    expect(isValidAssetCode('US-DC')).toBe(false);
    expect(isValidAssetCode('ABCDEFGHIJKLM')).toBe(false);
    expect(isValidAssetCode('')).toBe(false);
  });
});

describe('amountPattern', () => {
  it('allows up to the asset decimal precision', () => {
    expect(amountPattern(2).test('120.50')).toBe(true);
    expect(amountPattern(2).test('120.505')).toBe(false);
    expect(amountPattern(7).test('1.1234567')).toBe(true);
  });

  it('rejects fractions entirely for zero-decimal assets', () => {
    expect(amountPattern(0).test('120')).toBe(true);
    expect(amountPattern(0).test('120.5')).toBe(false);
  });
});

describe('validateField', () => {
  const limits = getAssetLimits('USDC');

  it('requires a value for required fields', () => {
    expect(validateField(amountField, '   ', 'USDC', limits)).toBe('Amount is required.');
  });

  it('accepts an empty value for optional fields', () => {
    const optional: FieldRequirement = { key: 'memo', label: 'Memo', required: false };
    expect(validateField(optional, '', 'USDC', limits)).toBe('');
  });

  it('rejects too many decimal digits', () => {
    expect(validateField(amountField, '10.123', 'USDC', limits)).toBe(
      'Enter a valid amount with up to 2 decimal places.',
    );
  });

  it('rejects amounts below the asset minimum, naming the asset', () => {
    expect(validateField(amountField, '5', 'USDC', limits)).toBe('Minimum USDC deposit is 10.');
    expect(validateField(amountField, '5', 'ARST', getAssetLimits('ARST'))).toBe(
      'Minimum ARST deposit is 5,000.',
    );
  });

  it('rejects amounts above the asset maximum', () => {
    expect(validateField(amountField, '100001', 'USDC', limits)).toBe(
      'Maximum USDC deposit is 100,000.',
    );
  });

  it('accepts an amount exactly on each bound', () => {
    expect(validateField(amountField, '10', 'USDC', limits)).toBe('');
    expect(validateField(amountField, '100000', 'USDC', limits)).toBe('');
  });

  it('rejects zero and non-numeric input', () => {
    expect(validateField(amountField, '0', 'USDC', limits)).toBe(
      'Deposit amount must be greater than zero.',
    );
    expect(validateField(amountField, 'abc', 'USDC', limits)).toContain('Enter a valid amount');
  });

  it('validates Stellar wallet addresses', () => {
    expect(validateField(walletField, VALID_WALLET, 'USDC', limits)).toBe('');
    expect(validateField(walletField, 'not-a-key', 'USDC', limits)).toBe(
      'Enter a valid Stellar wallet address starting with G.',
    );
  });

  it('validates asset-code fields against the SEP-24 format', () => {
    const field: FieldRequirement = { key: 'assetCode', label: 'Asset Code', required: true };
    expect(validateField(field, 'USDC', 'USDC', limits)).toBe('');
    expect(validateField(field, 'us dc', 'USDC', limits)).toBe(
      'Enter a valid asset code (1-12 uppercase letters or digits).',
    );
  });
});

describe('buildDepositSchema', () => {
  it('reports one issue per invalid field, keyed by field name', () => {
    const schema = buildDepositSchema(FIELDS, 'USDC', getAssetLimits('USDC'));
    const result = schema.safeParse({ walletAddress: 'nope', amount: '2' });

    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['walletAddress', 'amount']));
  });

  it('passes a fully valid payload', () => {
    const schema = buildDepositSchema(FIELDS, 'USDC', getAssetLimits('USDC'));
    expect(schema.safeParse({ walletAddress: VALID_WALLET, amount: '50.25' }).success).toBe(true);
  });

  it('tracks the asset it was built for', () => {
    const schema = buildDepositSchema(FIELDS, 'ARST', getAssetLimits('ARST'));
    const result = schema.safeParse({ walletAddress: VALID_WALLET, amount: '50' });

    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toBe('Minimum ARST deposit is 5,000.');
  });
});

describe('<DepositForm />', () => {
  const setup = (assetCode = 'USDC') => {
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <DepositForm fields={FIELDS} assetCode={assetCode} onSubmit={onSubmit} />
      </I18nProvider>,
    );
    return { onSubmit };
  };

  const submit = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Verification' }));

  it('blocks submission and never calls onSubmit when required fields are empty', async () => {
    const { onSubmit } = setup();

    submit();

    await screen.findByText('Amount is required.');
    expect(screen.getByText('Wallet Address is required.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submission for an amount below the asset minimum', async () => {
    const { onSubmit } = setup();

    fireEvent.change(screen.getByLabelText(/Wallet Address/), {
      target: { value: VALID_WALLET },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '5' } });
    submit();

    await screen.findByText('Minimum USDC deposit is 10.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks submission for too many decimal digits', async () => {
    const { onSubmit } = setup();

    fireEvent.change(screen.getByLabelText(/Wallet Address/), {
      target: { value: VALID_WALLET },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '10.999' } });
    submit();

    await screen.findByText('Enter a valid amount with up to 2 decimal places.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('applies the bounds of the asset on screen', async () => {
    const { onSubmit } = setup('ARST');

    fireEvent.change(screen.getByLabelText(/Wallet Address/), {
      target: { value: VALID_WALLET },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '100' } });
    submit();

    await screen.findByText('Minimum ARST deposit is 5,000.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('marks invalid fields with aria-invalid and a red border', async () => {
    setup();

    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '1' } });
    submit();

    await screen.findByText('Minimum USDC deposit is 10.');
    const amount = screen.getByLabelText(/Amount/);
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(amount.className).toContain('border-rose-500/60');
  });

  it('summarises the failure count after a rejected submit', async () => {
    setup();

    submit();

    expect(await screen.findByText(/Unable to Process Deposit/)).toBeTruthy();
    expect(screen.getByText(/Please fix 2 validation errors before continuing./)).toBeTruthy();
  });

  it('submits the collected values once every field is valid', async () => {
    const { onSubmit } = setup();

    fireEvent.change(screen.getByLabelText(/Wallet Address/), {
      target: { value: VALID_WALLET },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '250.75' } });
    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      { walletAddress: VALID_WALLET, amount: '250.75' },
      expect.any(AbortSignal),
    );
  });

  it('clears the field error as soon as the value is corrected', async () => {
    setup();

    const amount = screen.getByLabelText(/Amount/);
    fireEvent.change(amount, { target: { value: '1' } });
    submit();
    await screen.findByText('Minimum USDC deposit is 10.');

    fireEvent.change(amount, { target: { value: '25' } });
    await waitFor(() =>
      expect(screen.queryByText('Minimum USDC deposit is 10.')).toBeNull(),
    );
  });
});

describe('<DepositForm /> high-value confirmation', () => {
  const stubCapability = (available: boolean) => {
    Object.defineProperty(window, 'PublicKeyCredential', {
      configurable: true,
      value: {
        isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(available),
      },
    });
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { get: vi.fn() },
    });
  };

  const fillForm = (amount: string) => {
    fireEvent.change(screen.getByLabelText(/Wallet Address/), { target: { value: VALID_WALLET } });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: amount } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Verification' }));
  };

  beforeEach(() => {
    localStorage.clear();
    stubCapability(true);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'credentials');
    Reflect.deleteProperty(window, 'PublicKeyCredential');
    vi.unstubAllGlobals();
  });

  it('holds the deposit until biometric verification succeeds', async () => {
    saveBiometricSettings({ enabled: true, thresholdUsd: 100 });
    const authenticate = vi.fn().mockResolvedValue({ userVerified: true });
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <DepositForm fields={FIELDS} assetCode="USDC" onSubmit={onSubmit} onAuthenticate={authenticate} />
      </I18nProvider>,
    );

    fillForm('250.75');
    expect(await screen.findByTestId('biometric-amount')).toHaveTextContent('250.75 USDC');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('biometric-verify-button'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      { walletAddress: VALID_WALLET, amount: '250.75' },
      expect.any(AbortSignal),
    );
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it('does not submit a high-value deposit when confirmation is cancelled', async () => {
    saveBiometricSettings({ enabled: true, thresholdUsd: 100 });
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <DepositForm fields={FIELDS} assetCode="USDC" onSubmit={onSubmit} onAuthenticate={vi.fn()} />
      </I18nProvider>,
    );

    fillForm('500');
    fireEvent.click(await screen.findByTestId('biometric-cancel'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('biometric-verify-button')).not.toBeInTheDocument();
  });

  it('does not prompt when the amount is at or below the threshold', async () => {
    saveBiometricSettings({ enabled: true, thresholdUsd: 1_000 });
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <DepositForm fields={FIELDS} assetCode="USDC" onSubmit={onSubmit} />
      </I18nProvider>,
    );

    fillForm('500');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('biometric-verify-button')).not.toBeInTheDocument();
  });

  it('uses the password/PIN fallback on devices without WebAuthn', async () => {
    saveBiometricSettings({ enabled: true, thresholdUsd: 100 });
    Reflect.deleteProperty(navigator, 'credentials');
    Reflect.deleteProperty(window, 'PublicKeyCredential');
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <DepositForm fields={FIELDS} assetCode="USDC" onSubmit={onSubmit} />
      </I18nProvider>,
    );

    fillForm('500');
    fireEvent.change(await screen.findByTestId('biometric-fallback-input'), {
      target: { value: '1234' },
    });
    fireEvent.click(screen.getByTestId('biometric-fallback-confirm'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('<DepositForm /> double-submission guard', () => {
  const fillValid = () => {
    fireEvent.change(screen.getByLabelText(/Wallet Address/), {
      target: { value: VALID_WALLET },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '250.75' } });
  };

  const renderForm = (onSubmit: (values: Record<string, string>, signal?: AbortSignal) => Promise<void>) =>
    render(
      <I18nProvider>
        <DepositForm fields={FIELDS} assetCode="USDC" onSubmit={onSubmit} />
      </I18nProvider>,
    );

  it('fires a single request when submit is clicked repeatedly on a slow network', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    renderForm(onSubmit);
    fillValid();

    const button = screen.getByRole('button', { name: 'Continue to Verification' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    const processing = await screen.findByRole('button', { name: /Processing/ });
    expect(processing).toBeDisabled();
    fireEvent.click(processing);

    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolve();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue to Verification' })).toBeEnabled(),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('re-enables the button and shows a retryable error when the request fails', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Gateway timeout')).mockResolvedValueOnce(undefined);
    renderForm(onSubmit);
    fillValid();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Verification' }));
    expect(await screen.findByText('Gateway timeout')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Continue to Verification' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  it('aborts the in-flight request when the form unmounts', async () => {
    let captured: AbortSignal | undefined;
    const onSubmit = vi.fn((_v: Record<string, string>, signal?: AbortSignal) => {
      captured = signal;
      return new Promise<void>(() => {});
    });
    const { unmount } = renderForm(onSubmit);
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Verification' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    unmount();
    expect(captured?.aborted).toBe(true);
  });
});
