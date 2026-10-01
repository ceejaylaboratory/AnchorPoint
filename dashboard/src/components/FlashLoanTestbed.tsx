import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import { Address, Contract, nativeToScVal, TransactionBuilder, Account, rpc } from '@stellar/stellar-sdk';

/** Basis-point denominator — the flash loan provider's fee is quoted in bps. */
const BPS_DENOMINATOR = 10_000n;

export interface FlashLoanTestbedProps {
  /** Flash loan provider contract (`src/flash_loan`), the contract that holds the liquidity. */
  providerContractId: string;
  /** Soroban RPC endpoint the simulation is run against. */
  rpcUrl: string;
  /** Network passphrase for the simulated transaction. Defaults to testnet. */
  networkPassphrase?: string;
}

export interface FlashLoanTestbedParams {
  /** Borrowed token — a SEP-41 / Stellar Asset Contract address. */
  borrowAsset: string;
  /** Amount to borrow, in the token's smallest unit. */
  amount: string;
  /** The arbitrage callback contract implementing `execute_loan`. */
  callbackContractId: string;
  /**
   * Amount the callback is expected to return, in the same unit as `amount`.
   * The on-chain receiver returns no value, so the operator states the
   * expected proceeds and the testbed prices the simulated execution
   * against it.
   */
  expectedOutput: string;
}

export interface FlashLoanFeeBreakdown {
  /** Borrowed principal, in smallest units. */
  borrowed: bigint;
  /** Provider fee (`get_fee_bps` of the borrowed amount). */
  flashFee: bigint;
  /** Principal plus provider fee — what the callback must return. */
  requiredRepayment: bigint;
  /** Soroban resource fee the simulated invocation costs, in stroops. */
  networkFee: bigint;
  /** Expected proceeds the operator declared. */
  expectedOutput: bigint;
  /** `expectedOutput - requiredRepayment - networkFee`; negative means a loss. */
  netProfit: bigint;
  /** Fee rate read from the provider contract, in bps. */
  feeBps: number;
  /** True when the simulation is profitable after both fee legs. */
  profitable: boolean;
}

export interface FlashLoanSimulationResult extends FlashLoanFeeBreakdown {
  /** The simulation the numbers were derived from, for the gas estimate row. */
  minResourceFee: string;
  cpuInstructions: number;
  memBytes: number;
}

export type FlashLoanValidationErrors = Partial<Record<keyof FlashLoanTestbedParams, string>>;

/**
 * Validates the testbed inputs. Returns a field-keyed error map, empty when
 * every parameter is usable for a simulation.
 */
export function validateFlashLoanParams(params: FlashLoanTestbedParams): FlashLoanValidationErrors {
  const errors: FlashLoanValidationErrors = {};

  const asset = params.borrowAsset.trim();
  if (!asset) {
    errors.borrowAsset = 'Borrow asset is required';
  } else {
    try {
      Address.fromString(asset);
    } catch {
      errors.borrowAsset = 'Borrow asset must be a valid Stellar token contract address';
    }
  }

  const callback = params.callbackContractId.trim();
  if (!callback) {
    errors.callbackContractId = 'Callback contract is required';
  } else {
    try {
      Address.fromString(callback);
    } catch {
      errors.callbackContractId = 'Callback contract must be a valid Stellar contract address';
    }
  }

  const amount = params.amount.trim();
  if (!amount) {
    errors.amount = 'Amount is required';
  } else if (!/^\d+$/.test(amount)) {
    errors.amount = 'Amount must be a positive integer in the token base unit';
  } else if (BigInt(amount) <= 0n) {
    errors.amount = 'Amount must be greater than zero';
  }

  const output = params.expectedOutput.trim();
  if (!output) {
    errors.expectedOutput = 'Expected output is required';
  } else if (!/^\d+$/.test(output)) {
    errors.expectedOutput = 'Expected output must be a non-negative integer in the token base unit';
  }

  return errors;
}

/** `amount * feeBps / 10_000`, matching the provider's `calculate_fee` rounding. */
export function calculateFlashFee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps)) / BPS_DENOMINATOR;
}

/** Splits a Soroban simulation response into the fields the testbed displays. */
function readSimulationCost(simulation: unknown): {
  minResourceFee: bigint;
  cpuInstructions: number;
  memBytes: number;
} {
  const result = (simulation ?? {}) as {
    cost?: { cpuInsns?: string | number; memBytes?: string | number };
    minResourceFee?: string | number;
  };
  const cost = result.cost ?? {};

  return {
    minResourceFee: BigInt(result.minResourceFee ?? 0),
    cpuInstructions: Number(cost.cpuInsns ?? 0),
    memBytes: Number(cost.memBytes ?? 0),
  };
}

/**
 * Reads the provider's configured fee rate with a read-only simulation of
 * `get_fee_bps()`.
 */
async function fetchFeeBps(
  server: rpc.Server,
  providerContractId: string,
  networkPassphrase: string,
): Promise<number> {
  const account = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');
  const provider = new Contract(providerContractId);
  const transaction = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(provider.call('get_fee_bps'))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error('Simulation failed while reading the provider fee');
  }

  const raw = (simulation as { result?: { retval?: unknown } }).result?.retval;
  return Number(raw ?? 0);
}

/**
 * Simulates the arbitrage borrow end-to-end and prices it.
 *
 * The callback's `execute_loan` returns no value on-chain, so profitability
 * cannot be read from the simulation: the provider fee and the Soroban
 * resource fee come from RPC, and the operator's expected output is what
 * the net figure is measured against. Nothing here signs or submits — the
 * testbed only ever simulates.
 */
export async function simulateFlashLoanArbitrage(
  params: FlashLoanTestbedParams,
  options: {
    providerContractId: string;
    rpcUrl: string;
    networkPassphrase: string;
  },
): Promise<FlashLoanSimulationResult> {
  const server = new rpc.Server(options.rpcUrl, {
    allowHttp: options.rpcUrl.startsWith('http://'),
  });

  const amount = BigInt(params.amount.trim());
  const expectedOutput = BigInt(params.expectedOutput.trim());
  const callbackAddress = Address.fromString(params.callbackContractId.trim());
  const tokenAddress = Address.fromString(params.borrowAsset.trim());

  const [feeBps, cost] = await Promise.all([
    fetchFeeBps(server, options.providerContractId, options.networkPassphrase),
    (async () => {
      const account = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');
      const provider = new Contract(options.providerContractId);
      const transaction = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: options.networkPassphrase,
      })
        .addOperation(
          provider.call(
            'flash_loan',
            nativeToScVal(callbackAddress, { type: 'address' }),
            nativeToScVal(tokenAddress, { type: 'address' }),
            nativeToScVal(amount, { type: 'i128' }),
          ),
        )
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(transaction);
      if (rpc.Api.isSimulationError(simulation)) {
        throw new Error('Simulation failed for flash_loan — the callback path is not executable');
      }
      return readSimulationCost(simulation);
    })(),
  ]);

  const flashFee = calculateFlashFee(amount, feeBps);
  const requiredRepayment = amount + flashFee;
  // The resource fee is denominated in stroops (1 XLM = 10^7 stroops).
  const netProfit = expectedOutput - requiredRepayment - cost.minResourceFee;

  return {
    borrowed: amount,
    flashFee,
    requiredRepayment,
    networkFee: cost.minResourceFee,
    expectedOutput,
    netProfit,
    feeBps,
    profitable: netProfit > 0n,
    minResourceFee: cost.minResourceFee.toString(),
    cpuInstructions: cost.cpuInstructions,
    memBytes: cost.memBytes,
  };
}

const formatUnits = (value: bigint): string => {
  const whole = value / 10_000n;
  const fraction = (value % 10_000n).toString().padStart(4, '0');
  return `${whole.toString()}.${fraction}`;
};

const formatCount = (value: number): string => value.toLocaleString('en-US');

export const FlashLoanTestbed: React.FC<FlashLoanTestbedProps> = ({
  providerContractId,
  rpcUrl,
  networkPassphrase = 'Test SDF Network ; September 2015',
}) => {
  const [params, setParams] = useState<FlashLoanTestbedParams>({
    borrowAsset: '',
    amount: '',
    callbackContractId: '',
    expectedOutput: '',
  });
  const [result, setResult] = useState<FlashLoanSimulationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const errors = useMemo(() => validateFlashLoanParams(params), [params]);
  const hasErrors = Object.keys(errors).length > 0;

  const update = (field: keyof FlashLoanTestbedParams) => (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setParams((current) => ({ ...current, [field]: event.target.value }));
  };

  const runSimulation = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const simulation = await simulateFlashLoanArbitrage(params, {
        providerContractId,
        rpcUrl,
        networkPassphrase,
      });
      setResult(simulation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setRunning(false);
    }
  }, [params, providerContractId, rpcUrl, networkPassphrase]);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors) return;
    void runSimulation();
  };

  const showError = (field: keyof FlashLoanTestbedParams): string | null => {
    if (!submitted) return null;
    return errors[field] ?? null;
  };

  return (
    <form className="glass-card p-6" onSubmit={onSubmit} aria-label="Flash loan arbitrage testbed">
      <div className="mb-4 flex items-center gap-2">
        <Calculator size={16} className="text-primary" aria-hidden="true" />
        <h3 className="text-lg font-bold">Flash Loan Testbed</h3>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Simulates a flash loan against the provider contract. Nothing is signed or submitted — only
        simulated.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="flashloan-borrow-asset" className="text-xs font-medium text-slate-300">
            Borrow asset (token contract)
          </label>
          <input
            id="flashloan-borrow-asset"
            name="borrowAsset"
            value={params.borrowAsset}
            onChange={update('borrowAsset')}
            placeholder="C... token contract id"
            aria-invalid={Boolean(showError('borrowAsset'))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          {showError('borrowAsset') && (
            <p role="alert" className="text-xs text-red-400">
              {showError('borrowAsset')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="flashloan-amount" className="text-xs font-medium text-slate-300">
            Amount (base units)
          </label>
          <input
            id="flashloan-amount"
            name="amount"
            inputMode="numeric"
            value={params.amount}
            onChange={update('amount')}
            placeholder="10000000"
            aria-invalid={Boolean(showError('amount'))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          {showError('amount') && (
            <p role="alert" className="text-xs text-red-400">
              {showError('amount')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="flashloan-callback" className="text-xs font-medium text-slate-300">
            Callback contract
          </label>
          <input
            id="flashloan-callback"
            name="callbackContractId"
            value={params.callbackContractId}
            onChange={update('callbackContractId')}
            placeholder="C... arbitrage callback"
            aria-invalid={Boolean(showError('callbackContractId'))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          {showError('callbackContractId') && (
            <p role="alert" className="text-xs text-red-400">
              {showError('callbackContractId')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="flashloan-expected-output" className="text-xs font-medium text-slate-300">
            Expected output (base units)
          </label>
          <input
            id="flashloan-expected-output"
            name="expectedOutput"
            inputMode="numeric"
            value={params.expectedOutput}
            onChange={update('expectedOutput')}
            placeholder="10000700"
            aria-invalid={Boolean(showError('expectedOutput'))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          {showError('expectedOutput') && (
            <p role="alert" className="text-xs text-red-400">
              {showError('expectedOutput')}
            </p>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={running}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        {running ? (
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        ) : (
          <Calculator size={14} aria-hidden="true" />
        )}
        {running ? 'Simulating…' : 'Run simulation'}
      </button>

      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {result && (
        <section className="mt-4" aria-label="Simulation result">
          <div
            className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
              result.profitable
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/20 bg-amber-500/10 text-amber-300'
            }`}
            role="status"
          >
            {result.profitable ? (
              <TrendingUp size={14} aria-hidden="true" />
            ) : (
              <TrendingDown size={14} aria-hidden="true" />
            )}
            <span>
              Estimated net {result.profitable ? 'profit' : 'loss'}:{' '}
              {result.netProfit > 0n ? '+' : '-'}
              {formatUnits(result.netProfit < 0n ? -result.netProfit : result.netProfit)}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <dt className="text-slate-500">Borrowed</dt>
            <dd className="font-medium text-slate-200">{formatUnits(result.borrowed)}</dd>
            <dt className="text-slate-500">Provider fee</dt>
            <dd className="font-medium text-slate-200">
              {formatUnits(result.flashFee)} ({result.feeBps} bps)
            </dd>
            <dt className="text-slate-500">Required repayment</dt>
            <dd className="font-medium text-slate-200">{formatUnits(result.requiredRepayment)}</dd>
            <dt className="text-slate-500">Network fee</dt>
            <dd className="font-medium text-slate-200">{formatUnits(result.networkFee)}</dd>
            <dt className="text-slate-500">Expected output</dt>
            <dd className="font-medium text-slate-200">{formatUnits(result.expectedOutput)}</dd>
            <dt className="text-slate-500">CPU instructions</dt>
            <dd className="font-medium text-slate-200">{formatCount(result.cpuInstructions)}</dd>
            <dt className="text-slate-500">Memory bytes</dt>
            <dd className="font-medium text-slate-200">{formatCount(result.memBytes)}</dd>
          </dl>

          <p className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
            <CheckCircle2 size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            Simulation only — no transaction was signed or submitted.
          </p>
        </section>
      )}
    </form>
  );
};

export default FlashLoanTestbed;
