// CIRCUIT BREAKER APPROACH: Option B — breaker-wrapped service proxies
// Rationale: Option B encapsulates the circuit breaker logic within a proxy class. Callers use the proxies exactly as they would the raw clients, guaranteeing safety by default, preventing accidental bypasses, and keeping business logic completely decoupled from infrastructure failure handling.

import CircuitBreaker from 'opossum';
import { breakerRegistry } from './breaker-registry';

// Re-export BreakerOptions so callers can provide custom tuning
export type BreakerOptions = CircuitBreaker.Options;

/**
 * Creates a consistently configured opossum CircuitBreaker.
 *
 * @param name - The unique name for this breaker (used for telemetry).
 * @param action - The async function to wrap.
 * @param options - Optional custom tuning for specific endpoints.
 */
export function createBreaker<TI extends any[], TR>(
  name: string,
  action: (...args: TI) => Promise<TR>,
  options?: Partial<BreakerOptions>
): CircuitBreaker<TI, TR> {
  const defaultOptions: BreakerOptions = {
    // Timeout in milliseconds before a request is considered failed
    timeout: 5000,
    // Percentage of requests that must fail before the breaker trips OPEN
    errorThresholdPercentage: 50,
    // Time in milliseconds to wait before attempting to test the service again (HALF_OPEN)
    resetTimeout: 30000,
    // Minimum number of requests in the rolling window before the breaker can open
    volumeThreshold: 10,
    // Provide a name to the breaker for easier metric identification
    name,
  };

  const finalOptions = { ...defaultOptions, ...options };
  const breaker = new CircuitBreaker(action, finalOptions);

  // Register every breaker created into the global registry for telemetry
  breakerRegistry.register(name, breaker);

  return breaker;
}
