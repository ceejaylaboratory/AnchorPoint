import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  FlashLoanTestbed,
  calculateFlashFee,
  simulateFlashLoanArbitrage,
  validateFlashLoanParams,
  type FlashLoanTestbedParams,
} from './FlashLoanTestbed';

const TOKEN = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const CALLBACK = 'CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4XFM';
const RPC_URL = 'https://soroban-testnet.stellar.org';

const simulateTransaction = vi.fn();

vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual<typeof import('@stellar/stellar-sdk')>(
    '@stellar/stellar-sdk',
  );
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn(function Server(this: unknown) {
        this.simulateTransaction = simulateTransaction;
        return this;
      } as never),
    },
  };
});

const baseParams: FlashLoanTestbedParams = {
  borrowAsset: TOKEN,
  amount: '10000000',
  callbackContractId: CALLBACK,
  expectedOutput: '10000600',
};

describe('validateFlashLoanParams', () => {
  it('accepts a fully specified parameter set', () => {
    expect(validateFlashLoanParams(baseParams)).toEqual({});
  });

  it('requires a borrow asset that is a valid Stellar address', () => {
    expect(validateFlashLoanParams({ ...baseParams, borrowAsset: '' })).toMatchObject({
      borrowAsset: expect.any(String),
    });
    expect(
      validateFlashLoanParams({ ...baseParams, borrowAsset: 'not-an-address' }),
    ).toMatchObject({ borrowAsset: expect.any(String) });
  });

  it('requires a callback contract that is a valid Stellar address', () => {
    expect(
      validateFlashLoanParams({ ...baseParams, callbackContractId: 'nope' }),
    ).toMatchObject({ callbackContractId: expect.any(String) });
  });

  it('rejects a non-integer, zero or negative amount', () => {
    expect(validateFlashLoanParams({ ...baseParams, amount: '1.5' })).toMatchObject({
      amount: expect.any(String),
    });
    expect(validateFlashLoanParams({ ...baseParams, amount: '0' })).toMatchObject({
      amount: expect.any(String),
    });
    expect(validateFlashLoanParams({ ...baseParams, amount: '' })).toMatchObject({
      amount: expect.any(String),
    });
  });

  it('allows a zero expected output but not a negative one', () => {
    expect(validateFlashLoanParams({ ...baseParams, expectedOutput: '0' })).toEqual({});
    expect(
      validateFlashLoanParams({ ...baseParams, expectedOutput: '-1' }),
    ).toMatchObject({ expectedOutput: expect.any(String) });
  });
});

describe('calculateFlashFee', () => {
  it('matches the provider rounding: amount * bps / 10_000', () => {
    expect(calculateFlashFee(10_000_000n, 5)).toBe(5_000n);
    expect(calculateFlashFee(10_000_000n, 9)).toBe(9_000n);
    expect(calculateFlashFee(1n, 5)).toBe(0n);
  });
});

describe('simulateFlashLoanArbitrage', () => {
  beforeEach(() => {
    simulateTransaction.mockReset();
  });

  it('reads the provider fee and the resource cost, then prices the trade', async () => {
    simulateTransaction
      // get_fee_bps -> 5 bps
      .mockResolvedValueOnce({ result: { retval: 5 } })
      // flash_loan simulation
      .mockResolvedValueOnce({
        cost: { cpuInsns: '1234', memBytes: '4096' },
        minResourceFee: '700',
      });

    const result = await simulateFlashLoanArbitrage(baseParams, {
      providerContractId: 'CPROVIDER',
      rpcUrl: RPC_URL,
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    expect(result.feeBps).toBe(5);
    expect(result.flashFee).toBe(5_000n);
    expect(result.requiredRepayment).toBe(10_005_000n);
    expect(result.networkFee).toBe(700n);
    expect(result.cpuInstructions).toBe(1234);
    expect(result.memBytes).toBe(4096);
    // 10_000_600 - 10_005_000 - 700 = -5_100
    expect(result.netProfit).toBe(-5_100n);
    expect(result.profitable).toBe(false);
  });

  it('surfaces a failed simulation instead of pricing it', async () => {
    simulateTransaction.mockResolvedValueOnce({
      error: 'HostError: Error(Contract, #1)',
    } as never);

    await expect(
      simulateFlashLoanArbitrage(baseParams, {
        providerContractId: 'CPROVIDER',
        rpcUrl: RPC_URL,
        networkPassphrase: 'Test SDF Network ; September 2015',
      }),
    ).rejects.toThrow(/Simulation failed/);
  });
});

describe('FlashLoanTestbed', () => {
  const renderTestbed = () =>
    render(
      <FlashLoanTestbed
        providerContractId="CPROVIDER"
        rpcUrl={RPC_URL}
        networkPassphrase="Test SDF Network ; September 2015"
      />,
    );

  beforeEach(() => {
    simulateTransaction.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks the simulation and shows field errors when the inputs are invalid', async () => {
    renderTestbed();

    fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));

    expect(await screen.findByText('Borrow asset is required')).toBeInTheDocument();
    expect(screen.getByText('Amount is required')).toBeInTheDocument();
    expect(screen.getByText('Callback contract is required')).toBeInTheDocument();
    expect(screen.getByText('Expected output is required')).toBeInTheDocument();
    expect(simulateTransaction).not.toHaveBeenCalled();
  });

  it('rejects a malformed amount before hitting the RPC', async () => {
    renderTestbed();

    fireEvent.change(screen.getByLabelText(/borrow asset/i), { target: { value: TOKEN } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText(/callback contract/i), {
      target: { value: CALLBACK },
    });
    fireEvent.change(screen.getByLabelText(/expected output/i), {
      target: { value: '10000600' },
    });

    fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));

    expect(
      await screen.findByText('Amount must be a positive integer in the token base unit'),
    ).toBeInTheDocument();
    expect(simulateTransaction).not.toHaveBeenCalled();
  });

  it('shows the fee breakdown and estimated loss for a valid simulation', async () => {
    simulateTransaction
      .mockResolvedValueOnce({ result: { retval: 5 } })
      .mockResolvedValueOnce({
        cost: { cpuInsns: '1234', memBytes: '4096' },
        minResourceFee: '700',
      });

    renderTestbed();

    fireEvent.change(screen.getByLabelText(/borrow asset/i), { target: { value: TOKEN } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '10000000' } });
    fireEvent.change(screen.getByLabelText(/callback contract/i), {
      target: { value: CALLBACK },
    });
    fireEvent.change(screen.getByLabelText(/expected output/i), {
      target: { value: '10000600' },
    });

    fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));

    await waitFor(() => {
      expect(screen.getByText(/estimated net loss/i)).toBeInTheDocument();
    });

    // Fee breakdown: 5 bps of 10_000_000 = 5_000, plus the 700 stroop network fee.
    expect(screen.getByText(/0\.5000 \(5 bps\)/)).toBeInTheDocument();
    expect(screen.getByText('1000.5000')).toBeInTheDocument();
    expect(screen.getByText('0.0000')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('4,096')).toBeInTheDocument();
    expect(screen.getByText(/no transaction was signed or submitted/i)).toBeInTheDocument();
  });

  it('reports a failed simulation as an alert', async () => {
    simulateTransaction.mockRejectedValueOnce(new Error('RPC unreachable'));

    renderTestbed();

    fireEvent.change(screen.getByLabelText(/borrow asset/i), { target: { value: TOKEN } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '10000000' } });
    fireEvent.change(screen.getByLabelText(/callback contract/i), {
      target: { value: CALLBACK },
    });
    fireEvent.change(screen.getByLabelText(/expected output/i), {
      target: { value: '10000600' },
    });

    fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));

    expect(await screen.findByText('RPC unreachable')).toBeInTheDocument();
  });
});
