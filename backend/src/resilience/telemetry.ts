// CIRCUIT BREAKER APPROACH: Option B — breaker-wrapped service proxies
// Rationale: Option B encapsulates the circuit breaker logic within a proxy class. Callers use the proxies exactly as they would the raw clients, guaranteeing safety by default, preventing accidental bypasses, and keeping business logic completely decoupled from infrastructure failure handling.

import logger from '../utils/logger';
import { breakerRegistry } from './breaker-registry';
// Using generic any to bypass potential typescript issues if opossum-prometheus types are missing
const OpossumPrometheus = require('opossum-prometheus');
import promClient from 'prom-client';

export function registerBreakerMetrics() {
  const breakers = breakerRegistry.getAll();
  
  // 1. Wire up opossum-prometheus
  // This automatically creates metrics: circuit_breaker_requests_total, circuit_breaker_failures_total, etc.
  // It hooks into the provided prometheus registry.
  try {
    for (const breaker of breakers.values()) {
      new OpossumPrometheus(breaker, { registry: promClient.register });
    }
  } catch (error) {
    logger.error('Failed to initialize opossum-prometheus', error);
  }

  // 2. Attach structured logging to opossum events
  for (const [name, breaker] of breakers.entries()) {
    breaker.on('open', () => {
      logger.warn(`[CIRCUIT_BREAKER] ${name} opened. Failing fast.`);
    });

    breaker.on('halfOpen', () => {
      logger.info(`[CIRCUIT_BREAKER] ${name} half-open. Testing service recovery.`);
    });

    breaker.on('close', () => {
      logger.info(`[CIRCUIT_BREAKER] ${name} closed. Service recovered normally.`);
    });

    breaker.on('fallback', (result, err) => {
      // Avoid spamming logs for expected fallbacks (e.g. cache misses), but keep a trace
      logger.debug(`[CIRCUIT_BREAKER] ${name} fallback executed. Error: ${err ? err.message : 'Unknown'}`);
    });

    breaker.on('timeout', () => {
      logger.warn(`[CIRCUIT_BREAKER] ${name} request timed out.`);
    });

    breaker.on('reject', () => {
      // This happens when the breaker is open and fast-fails a request
      logger.debug(`[CIRCUIT_BREAKER] ${name} rejected request (breaker is open).`);
    });
  }
}

export function getBreakerHealthSummary() {
  return breakerRegistry.getStatus();
}
