import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  CircuitBreakerBanner,
  formatCooldown,
  pollCircuitBreakerStatus,
} from './CircuitBreakerBanner';

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

const ok = (retval: unknown) => ({ result: { retval } });
const simError = () => ({ error: 'HostError: Error(Contract, #1)' } as never);

const readOptions = {
  contractId: 'CCIRCUIT',
  rpcUrl: RPC_URL,
  networkPassphrase: 'Test SDF Network ; September 2015',
};

describe('formatCooldown', () => {
  it.each([
    [0, '0:00'],
    [59, '0:59'],
    [60, '1:00'],
    [3661, '1:01:01'],
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(formatCooldown(seconds)).toBe(expected);
  });
});

describe('pollCircuitBreakerStatus', () => {
  beforeEach(() => {
    simulateTransaction.mockReset();
  });

  it('reports clear when the contract says nothing is paused', async () => {
    simulateTransaction.mockResolvedValueOnce(ok(0));

    const status = await pollCircuitBreakerStatus(readOptions);

    expect(status.state).toBe('clear');
    expect(status.tier).toBeNull();
    expect(status.secondsRemaining).toBeNull();
  });

  it('reports the pause tier and the cool-off remaining when paused', async () => {
    simulateTransaction
      .mockResolvedValueOnce(ok(1)) // is_paused
      .mockResolvedValueOnce(ok({ sym: 'withdraw' })) // get_pause_tier
      .mockResolvedValueOnce(ok(1_800_000_000n)); // get_unpause_unlock_time

    const status = await pollCircuitBreakerStatus({
      ...readOptions,
      now: 1_800_000_000 - 125,
    });

    expect(status.state).toBe('paused');
    expect(status.tier).toBe('withdraw');
    expect(status.unlockTime).toBe(1_800_000_000);
    expect(status.secondsRemaining).toBe(125);
  });

  it('reports unavailable rather than clear when the read fails', async () => {
    simulateTransaction.mockResolvedValueOnce(simError());

    const status = await pollCircuitBreakerStatus(readOptions);

    expect(status.state).toBe('unavailable');
    expect(status.error).toMatch(/Simulation failed/);
  });
});

describe('CircuitBreakerBanner', () => {
  const renderBanner = (pollIntervalMs = 60_000) =>
    render(
      <CircuitBreakerBanner
        contractId="CCIRCUIT"
        rpcUrl={RPC_URL}
        networkPassphrase="Test SDF Network ; September 2015"
        pollIntervalMs={pollIntervalMs}
      />,
    );

  beforeEach(() => {
    simulateTransaction.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing while the status is still loading', () => {
    simulateTransaction.mockReturnValue(new Promise(() => {}));

    const { container } = renderBanner();

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no circuit breaker is active', async () => {
    simulateTransaction.mockResolvedValue(ok(0));

    const { container } = renderBanner();

    await waitFor(() => {
      expect(simulateTransaction).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('shows the paused banner with a live cool-off countdown', async () => {
    const unlockTime = Math.floor(Date.now() / 1000) + 300;
    simulateTransaction
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(ok({ sym: 'all' }))
      .mockResolvedValueOnce(ok(BigInt(unlockTime)));

    renderBanner();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Protocol paused (all)');
    expect(banner).toHaveTextContent(/Swaps and withdrawals are temporarily disabled/i);

    const timer = screen.getByRole('timer');
    expect(timer).toHaveTextContent(/Cool-off [0-9]+:[0-9]{2}/);

    // The countdown ticks down without another contract read.
    const readsAfterFirstPoll = simulateTransaction.mock.calls.length;
    await new Promise((resolve) => {
      setTimeout(resolve, 1100);
    });
    expect(simulateTransaction.mock.calls.length).toBe(readsAfterFirstPoll);
  });

  it('falls back to a pending label when the unlock time is unknown', async () => {
    simulateTransaction
      .mockResolvedValueOnce(ok(1))
      .mockResolvedValueOnce(ok({ sym: 'swap' }))
      .mockResolvedValueOnce(ok(0n));

    renderBanner();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Protocol paused (swap)');
    expect(banner).toHaveTextContent(/Cool-off pending/i);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('surfaces a failed read as a verification warning with a retry', async () => {
    simulateTransaction.mockResolvedValueOnce(simError());

    renderBanner();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/Circuit breaker status unavailable/i);
    expect(banner).toHaveTextContent(/pause state is unverified/i);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
