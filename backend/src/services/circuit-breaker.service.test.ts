import {
  CircuitBreakerRegistry,
  circuitBreakerRegistry,
  CircuitBreakerError,
  CircuitState,
} from './circuit-breaker.service';

describe('CircuitBreaker', () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry();
  });

  afterEach(() => {
    registry.resetAll();
  });

  describe('Closed State (Normal Operation)', () => {
    it('should allow requests when closed', async () => {
      const breaker = registry.get('test-closed');
      const fn = jest.fn().mockResolvedValue('success');

      const result = await breaker.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
    });

    it('should track failures in closed state', async () => {
      const breaker = registry.get('test-failures', { failureThreshold: 3 });
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      // Fail 2 times (below threshold)
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      await expect(breaker.execute(fn)).rejects.toThrow('fail');

      const metrics = breaker.getMetrics();
      expect(metrics.failures).toBe(2);
      expect(metrics.state).toBe(CircuitState.CLOSED);
    });

    it('should open after failure threshold is reached', async () => {
      const breaker = registry.get('test-open', { failureThreshold: 3 });
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      // Fail 3 times (at threshold)
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('fail');
      }

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.OPEN);
    });
  });

  describe('Open State (Circuit Broken)', () => {
    it('should reject requests when open', async () => {
      const breaker = registry.get('test-reject', { failureThreshold: 1 });
      const fn = jest.fn().mockRejectedValue(new Error('fail'));

      // Fail once to open circuit
      await expect(breaker.execute(fn)).rejects.toThrow('fail');

      // Next request should be rejected
      const successFn = jest.fn().mockResolvedValue('success');
      await expect(breaker.execute(successFn)).rejects.toThrow(CircuitBreakerError);

      expect(successFn).not.toHaveBeenCalled();
    });

    it('should track rejected calls', async () => {
      const breaker = registry.get('test-rejected', { failureThreshold: 1 });

      // Open the circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      // Try again and get rejected
      await breaker.execute(() => Promise.resolve('success')).catch(() => {});

      const metrics = breaker.getMetrics();
      expect(metrics.rejectedCalls).toBe(1);
    });
  });

  describe('Half-Open State (Recovery)', () => {
    it('should enter half-open after timeout', async () => {
      const breaker = registry.get('test-half-open', {
        failureThreshold: 1,
        resetTimeoutMs: 100,
      });

      // Open the circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Next call should be allowed (half-open)
      const fn = jest.fn().mockResolvedValue('success');
      await breaker.execute(fn);

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.HALF_OPEN);
    });

    it('should close after success threshold in half-open', async () => {
      const breaker = registry.get('test-close', {
        failureThreshold: 1,
        resetTimeoutMs: 100,
        halfOpenMaxCalls: 5,
        successThreshold: 2,
      });

      // Open the circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Succeed twice
      await breaker.execute(() => Promise.resolve('success'));
      await breaker.execute(() => Promise.resolve('success'));

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.CLOSED);
    });

    it('should reopen on failure in half-open', async () => {
      const breaker = registry.get('test-reopen', {
        failureThreshold: 1,
        resetTimeoutMs: 100,
      });

      // Open the circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Fail in half-open
      await breaker.execute(() => Promise.reject(new Error('fail again'))).catch(() => {});

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.OPEN);
    });

    it('should limit calls in half-open state', async () => {
      const breaker = registry.get('test-limit', {
        failureThreshold: 1,
        resetTimeoutMs: 100,
        halfOpenMaxCalls: 2,
      });

      // Open the circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Make max allowed calls
      await breaker.execute(() => Promise.resolve('1'));
      await breaker.execute(() => Promise.resolve('2'));

      // Next call should be rejected
      await expect(
        breaker.execute(() => Promise.resolve('3'))
      ).rejects.toThrow(CircuitBreakerError);
    });
  });

  describe('Configuration', () => {
    it('should use custom configuration', async () => {
      const breaker = registry.get('test-custom', {
        failureThreshold: 5,
        resetTimeoutMs: 10000,
        halfOpenMaxCalls: 3,
        successThreshold: 2,
      });

      // Fail 4 times (below threshold)
      const fn = jest.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 4; i++) {
        await expect(breaker.execute(fn)).rejects.toThrow('fail');
      }

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('Force State Changes', () => {
    it('should allow force open', () => {
      const breaker = registry.get('test-force');
      breaker.forceOpen();

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe(CircuitState.OPEN);
    });

    it('should allow force close', async () => {
      const breaker = registry.get('test-force-close', { failureThreshold: 1 });

      // Open the circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);

      // Force close
      breaker.forceClose();
      expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
    });
  });

  describe('Metrics', () => {
    it('should track total calls', async () => {
      const breaker = registry.get('test-total');

      await breaker.execute(() => Promise.resolve('1'));
      await breaker.execute(() => Promise.resolve('2'));
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      const metrics = breaker.getMetrics();
      expect(metrics.totalCalls).toBe(3);
    });

    it('should track last failure time', async () => {
      const breaker = registry.get('test-last-fail');
      const beforeFail = Date.now();

      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      const metrics = breaker.getMetrics();
      expect(metrics.lastFailureTime).not.toBeNull();
      expect(metrics.lastFailureTime).toBeGreaterThanOrEqual(beforeFail);
    });
  });

  describe('CircuitBreakerError', () => {
    it('should include circuit name and state in error', async () => {
      const breaker = registry.get('test-error-name', { failureThreshold: 1 });

      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

      try {
        await breaker.execute(() => Promise.resolve('success'));
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitBreakerError);
        expect((err as CircuitBreakerError).circuitName).toBe('test-error-name');
        expect((err as CircuitBreakerError).state).toBe(CircuitState.OPEN);
      }
    });
  });

  describe('Registry', () => {
    it('should reuse existing breakers', () => {
      const breaker1 = registry.get('test-singleton');
      const breaker2 = registry.get('test-singleton');

      expect(breaker1).toBe(breaker2);
    });

    it('should return metrics for all breakers', async () => {
      const breaker1 = registry.get('test-metrics-1');
      const breaker2 = registry.get('test-metrics-2');

      await breaker1.execute(() => Promise.resolve('1'));
      await breaker2.execute(() => Promise.resolve('2'));

      const allMetrics = registry.getMetrics();

      expect(allMetrics['test-metrics-1']).toBeDefined();
      expect(allMetrics['test-metrics-2']).toBeDefined();
    });

    it('should reset all breakers', async () => {
      const breaker = registry.get('test-reset', { failureThreshold: 1 });

      // Open the circuit
      await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
      expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);

      // Reset all
      registry.resetAll();
      expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
    });
  });

  describe('Global Registry', () => {
    it('should provide singleton registry', () => {
      expect(circuitBreakerRegistry).toBeDefined();
      expect(circuitBreakerRegistry).toBeInstanceOf(CircuitBreakerRegistry);
    });
  });
});
