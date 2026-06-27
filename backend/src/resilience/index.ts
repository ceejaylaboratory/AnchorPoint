// CIRCUIT BREAKER APPROACH: Option B — breaker-wrapped service proxies
// Rationale: Option B encapsulates the circuit breaker logic within a proxy class. Callers use the proxies exactly as they would the raw clients, guaranteeing safety by default, preventing accidental bypasses, and keeping business logic completely decoupled from infrastructure failure handling.

export * from './circuit-breaker.factory';
export * from './breaker-registry';
export * from './horizon.proxy';
export * from './redis.proxy';
export * from './third-party.proxy';
export * from './telemetry';
