// IMPLEMENTATION APPROACH: Option A — Node.js/TypeScript + Express
// Rationale: Mirrors the existing scenarios pattern with a dedicated in-memory
// fault state that Horizon and Soroban route handlers can query, keeping fault
// injection decoupled from the happy-path scenario system.

import { Router, Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FaultType = 'NONE' | 'TIMEOUT' | 'RATE_LIMIT' | 'RPC_DOWN' | 'INVALID_HASH';

export interface FaultState {
  /** Which fault type is currently active. 'NONE' means no fault injected. */
  errorType: FaultType;
  /**
   * How many milliseconds to delay before responding when TIMEOUT is active.
   * Defaults to 5 000 ms to mimic a Stellar network stall.
   */
  delayMs: number;
}

// ---------------------------------------------------------------------------
// In-memory state (Node.js is single-threaded — no locking needed)
// ---------------------------------------------------------------------------

let activeFault: FaultState = {
  errorType: 'NONE',
  delayMs: 5000,
};

// ---------------------------------------------------------------------------
// Public helpers consumed by Horizon / Soroban route handlers
// ---------------------------------------------------------------------------

/** Returns a shallow copy of the current fault state. */
export const getActiveFault = (): FaultState => ({ ...activeFault });

/** Clear any active fault and return to normal operation. */
export const clearFault = (): void => {
  activeFault = { errorType: 'NONE', delayMs: 5000 };
};

/**
 * Apply the active fault to an in-flight request/response pair.
 *
 * Returns `true` if the fault consumed the response (caller should not
 * continue processing), or `false` if the request should proceed normally.
 */
export const applyFault = async (res: Response): Promise<boolean> => {
  const { errorType, delayMs } = activeFault;

  switch (errorType) {
    case 'TIMEOUT':
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      // After the delay the server simply times out — return a gateway-timeout
      // so test suites don't have to wait the full delay for a response.
      res.status(504).json({
        type: 'fault/timeout',
        title: 'Gateway Timeout',
        detail: 'Simulated network timeout from fault injection.',
      });
      return true;

    case 'RATE_LIMIT':
      res.status(429).json({
        type: 'fault/rate_limit',
        title: 'Too Many Requests',
        detail: 'Simulated rate-limit response from fault injection.',
        'retry-after': 60,
      });
      return true;

    case 'RPC_DOWN':
      res.status(503).json({
        type: 'fault/rpc_down',
        title: 'Service Unavailable',
        detail: 'Simulated RPC node outage from fault injection.',
      });
      return true;

    case 'INVALID_HASH':
      // INVALID_HASH is handled per-route (hash mutation) rather than a
      // blanket HTTP error, so callers handle it themselves.
      return false;

    case 'NONE':
    default:
      return false;
  }
};

// ---------------------------------------------------------------------------
// Admin Router — mounted at /mock/faults
// ---------------------------------------------------------------------------

export const faultRouter = Router();

const VALID_FAULT_TYPES: FaultType[] = ['NONE', 'TIMEOUT', 'RATE_LIMIT', 'RPC_DOWN', 'INVALID_HASH'];

/**
 * POST /mock/faults
 * Body: { errorType: FaultType, delayMs?: number }
 *
 * Activates a fault injection mode. Send { errorType: 'NONE' } to clear.
 */
faultRouter.post('/', (req: Request, res: Response): void => {
  const { errorType, delayMs } = req.body as Partial<FaultState>;

  if (!errorType || !VALID_FAULT_TYPES.includes(errorType)) {
    res.status(400).json({
      error: `Invalid errorType. Must be one of: ${VALID_FAULT_TYPES.join(', ')}`,
    });
    return;
  }

  activeFault = {
    errorType,
    delayMs: typeof delayMs === 'number' && delayMs >= 0 ? delayMs : 5000,
  };

  res.status(200).json({ activeFault });
});

/**
 * GET /mock/faults
 * Returns the currently active fault configuration.
 */
faultRouter.get('/', (_req: Request, res: Response): void => {
  res.status(200).json({ activeFault });
});

/**
 * DELETE /mock/faults
 * Clears any active fault and returns to normal operation.
 */
faultRouter.delete('/', (_req: Request, res: Response): void => {
  clearFault();
  res.status(200).json({ activeFault });
});
