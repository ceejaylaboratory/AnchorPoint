import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WithdrawalFlow,
  WithdrawRequestError,
  requestWithdrawInteractive,
  toWithdrawalError,
} from './WithdrawalFlow';
import { SEP24Flow } from './SEP24Flow';
import { I18nProvider } from '../i18n/config';
import type { UiConfig } from '../types';

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const uiConfig: UiConfig = {
  brandName: 'AnchorPoint',
  primaryColor: '#3b82f6',
  accentColor: '#14b8a6',
  supportEmail: 'support@anchorpoint.local',
  fieldRequirements: {
    deposit: [{ key: 'amount', label: 'Amount', required: true, placeholder: '500.00' }],
    withdraw: [
      { key: 'bankAccount', label: 'Bank Account', required: true, placeholder: 'Account number' },
      { key: 'amount', label: 'Amount', required: true, placeholder: '120.50' },
    ],
    kyc: [{ key: 'firstName', label: 'First Name', required: true }],
  },
};

const interactiveResponse = {
  type: 'interactive_customer_info_needed',
  url: 'https://anchor.example/kyc-withdraw?transaction_id=tx-123',
  id: 'tx-123',
  expires_at: '2026-01-01T00:00:00.000Z',
};

const noFee = vi.fn(() => new Promise<never>(() => {}));

const renderWithI18n = (ui: ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

const renderFlow = (onRequestInteractive = vi.fn().mockResolvedValue(interactiveResponse)) => {
  renderWithI18n(
    <WithdrawalFlow
      uiConfig={uiConfig}
      account="GABC"
      onRequestInteractive={onRequestInteractive}
      onEstimateFee={noFee}
    />,
  );
  return onRequestInteractive;
};

const continueFromAssetStep = () => {
  fireEvent.click(screen.getByRole('button', { name: /Continue with/i }));
};

const submitAmount = (amount = '100') => {
  fireEvent.change(screen.getByLabelText(/Bank Account/i), { target: { value: '12345678' } });
  fireEvent.change(screen.getByLabelText(/^Amount/i), { target: { value: amount } });
  fireEvent.click(screen.getByRole('button', { name: /Continue to Verification/i }));
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WithdrawalFlow step 1: asset selection', () => {
  it('starts on asset selection with USDC preselected', () => {
    renderFlow();
    expect(screen.getByRole('heading', { name: 'Withdrawal Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue with USDC/i })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4: Select Asset')).toBeInTheDocument();
  });

  it('advances to the amount step', () => {
    renderFlow();
    continueFromAssetStep();
    expect(screen.getByRole('heading', { name: 'Withdrawal Amount' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4: Amount')).toBeInTheDocument();
  });
});

describe('WithdrawalFlow step 2: amount', () => {
  it('does not call the anchor while the form is invalid', () => {
    const request = renderFlow();
    continueFromAssetStep();
    fireEvent.click(screen.getByRole('button', { name: /Continue to Verification/i }));
    expect(request).not.toHaveBeenCalled();
  });

  it('requests an interactive withdrawal with the asset, amount and destination', async () => {
    const request = renderFlow();
    continueFromAssetStep();
    submitAmount('100');

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith({
      asset_code: 'USDC',
      amount: '100',
      account: 'GABC',
      dest: '12345678',
    });
  });

  it('returns to asset selection when going back', () => {
    renderFlow();
    continueFromAssetStep();
    fireEvent.click(screen.getByRole('button', { name: /Back to asset selection/i }));
    expect(screen.getByRole('heading', { name: 'Withdrawal Assets' })).toBeInTheDocument();
  });
});

describe('WithdrawalFlow step 3: anchor webview', () => {
  it('loads the interactive URL returned by the anchor', async () => {
    renderFlow();
    continueFromAssetStep();
    submitAmount();

    const link = await screen.findByRole('link', { name: /Open AnchorPoint interactive flow/i });
    expect(link).toHaveAttribute('href', interactiveResponse.url);
    expect(screen.getByText('Step 3 of 4: Anchor Webview')).toBeInTheDocument();
  });

  it('shows a retryable alert when the webview is dismissed', async () => {
    renderFlow();
    continueFromAssetStep();
    submitAmount();

    fireEvent.click(await screen.findByText('Launch KYC Portal'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel KYC verification' }, { timeout: 3000 }));

    expect(await screen.findByText('Withdrawal Not Completed')).toBeInTheDocument();
    expect(screen.getByText(/closed before the withdrawal was confirmed/i)).toBeInTheDocument();
  });
});

describe('WithdrawalFlow step 4: confirmation', () => {
  it('confirms the withdrawal once the anchor flow completes', async () => {
    renderFlow();
    continueFromAssetStep();
    submitAmount('42');

    fireEvent.click(await screen.findByText('Launch KYC Portal'));
    fireEvent.click(await screen.findByRole('button', { name: 'Submit KYC and continue' }, { timeout: 3000 }));

    expect(await screen.findByText('Withdrawal Submitted', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId('withdrawal-transaction-id')).toHaveTextContent('tx-123');
    expect(screen.getByText('42')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start another withdrawal' }));
    expect(screen.getByRole('heading', { name: 'Withdrawal Assets' })).toBeInTheDocument();
  });
});

describe('WithdrawalFlow error handling', () => {
  it('shows a network error and retries the same request', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new WithdrawRequestError('Unable to reach the anchor.'))
      .mockResolvedValueOnce(interactiveResponse);
    renderFlow(request);
    continueFromAssetStep();
    submitAmount();

    expect(await screen.findByText('Network Error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry network operation' }));

    expect(await screen.findByRole('link', { name: /Open AnchorPoint interactive flow/i })).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toEqual(request.mock.calls[0][0]);
  });

  it('shows a non-retryable error for an unsupported asset', async () => {
    renderFlow(vi.fn().mockRejectedValue(new WithdrawRequestError('Asset EURT is not supported.', 400)));
    continueFromAssetStep();
    submitAmount();

    expect(await screen.findByText('Asset Not Supported')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Withdrawal Amount' })).toBeInTheDocument();
  });

  it('maps errors onto DepositErrorAlert types', () => {
    expect(toWithdrawalError(new WithdrawRequestError('down')).type).toBe('network');
    expect(toWithdrawalError(new WithdrawRequestError('boom', 503))).toMatchObject({ type: 'server', retryable: true });
    expect(toWithdrawalError(new WithdrawRequestError('asset_code is required', 400))).toMatchObject({
      type: 'validation',
      retryable: false,
    });
  });
});

describe('requestWithdrawInteractive', () => {
  it('POSTs to /sep24/transactions/withdraw/interactive', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => interactiveResponse });
    vi.stubGlobal('fetch', fetchMock);

    const result = await requestWithdrawInteractive('http://anchor.test', { asset_code: 'USDC', amount: '10' });

    expect(result).toEqual(interactiveResponse);
    expect(fetchMock).toHaveBeenCalledWith('http://anchor.test/sep24/transactions/withdraw/interactive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_code: 'USDC', amount: '10' }),
    });
  });

  it('surfaces the anchor error message and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'asset_code is required' }) }),
    );
    await expect(requestWithdrawInteractive('http://anchor.test', { asset_code: '' })).rejects.toMatchObject({
      message: 'asset_code is required',
      status: 400,
    });
  });

  it('reports a network failure without a status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(requestWithdrawInteractive('http://anchor.test', { asset_code: 'USDC' })).rejects.toMatchObject({
      status: undefined,
    });
  });
});

describe('SEP24Flow withdrawal tab', () => {
  it('switches between the deposit and withdrawal tabs', () => {
    renderWithI18n(<SEP24Flow type="deposit" uiConfig={uiConfig} />);

    const withdrawTab = screen.getByRole('tab', { name: 'Withdrawal' });
    expect(withdrawTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByTestId('withdrawal-flow')).not.toBeInTheDocument();

    fireEvent.click(withdrawTab);
    expect(withdrawTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('withdrawal-flow')).toBeInTheDocument();
  });

  it('opens on the withdrawal tab when type is withdraw', () => {
    renderWithI18n(<SEP24Flow type="withdraw" uiConfig={uiConfig} />);
    expect(screen.getByRole('tab', { name: 'Withdrawal' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Withdrawal Assets' })).toBeInTheDocument();
  });
});
