// CIRCUIT BREAKER APPROACH: Option B — breaker-wrapped service proxies
// Rationale: Option B encapsulates the circuit breaker logic within a proxy class. Callers use the proxies exactly as they would the raw clients, guaranteeing safety by default, preventing accidental bypasses, and keeping business logic completely decoupled from infrastructure failure handling.

import CircuitBreaker from 'opossum';

export interface BreakerStatus {
  name: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  stats: {
    fires: number;
    failures: number;
    successes: number;
    timeouts: number;
  };
}

class BreakerRegistry {
  private readonly breakers: Map<string, CircuitBreaker<any, any>> = new Map();

  register(name: string, breaker: CircuitBreaker<any, any>): void {
    if (this.breakers.has(name)) {
      // In development environments with hot-reloading, avoid crashing if re-registered.
      // But we update the reference just in case.
      this.breakers.set(name, breaker);
      return;
    }
    this.breakers.set(name, breaker);
  }

  getAll(): Map<string, CircuitBreaker<any, any>> {
    return this.breakers;
  }

  getStatus(): BreakerStatus[] {
    const statuses: BreakerStatus[] = [];
    
    for (const [name, breaker] of this.breakers.entries()) {
      let state: 'OPEN' | 'HALF_OPEN' | 'CLOSED' = 'CLOSED';
      if (breaker.opened) {
        state = 'OPEN';
      } else if (breaker.halfOpen) {
        state = 'HALF_OPEN';
      }

      statuses.push({
        name,
        state,
        stats: {
          fires: breaker.stats.fires,
          failures: breaker.stats.failures,
          successes: breaker.stats.successes,
          timeouts: breaker.stats.timeouts,
        },
      });
    }

    return statuses;
  }
}

// Singleton pattern — one registry per process
export const breakerRegistry = new BreakerRegistry();
