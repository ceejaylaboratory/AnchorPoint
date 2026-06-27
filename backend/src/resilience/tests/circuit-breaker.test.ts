import sinon from 'sinon';
import { createBreaker } from '../circuit-breaker.factory';
import { breakerRegistry } from '../breaker-registry';
import { redisProxy } from '../redis.proxy';

describe('Circuit Breaker Resilience Pattern', () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    // Control time for resetTimeout tests
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  it('breaker opens after hitting error threshold and falls back', async () => {
    const stub = sinon.stub().rejects(new Error('Service down'));
    const breaker = createBreaker('test-breaker-1', stub, {
      errorThresholdPercentage: 50,
      volumeThreshold: 2,
      resetTimeout: 10000,
    });
    
    // Fallback simply returns 'fallback-value'
    breaker.fallback(() => 'fallback-value');

    // Fire 2 times, both fail. Volume threshold met.
    await breaker.fire();
    await breaker.fire();

    // The third fire should immediately return fallback without hitting the stub
    const result = await breaker.fire();
    
    expect(result).toBe('fallback-value');
    expect(breaker.opened).toBe(true);
    // Stub was only called 2 times
    expect(stub.callCount).toBe(2);
  });

  it('breaker transitions to half-open and then closes on success', async () => {
    const stub = sinon.stub().rejects(new Error('Service down'));
    const breaker = createBreaker('test-breaker-2', stub, {
      errorThresholdPercentage: 50,
      volumeThreshold: 1,
      resetTimeout: 10000,
    });
    
    breaker.fallback(() => 'fallback');

    // Open the breaker
    await breaker.fire();
    expect(breaker.opened).toBe(true);

    // Advance time past resetTimeout
    clock.tick(10001);

    // It should be halfOpen (or will be on next fire)
    // We mock success now
    stub.resolves('success');

    // This fire goes through as a probe
    const result = await breaker.fire();
    
    expect(result).toBe('success');
    expect(breaker.opened).toBe(false); // Closed now
    expect(breaker.halfOpen).toBe(false);
  });

  it('Redis breaker opening does not throw — application continues', async () => {
    // For redisProxy, get returns null on fallback, set returns 'OK'
    // We'll simulate Redis failing by replacing the internal getBreaker's action using a mock.
    // However, since redisProxy encapsulates the breaker, we'll test the actual proxy method.
    // Note: The actual redis is mocked in tests via `backend/src/lib/redis.ts`. 
    // If the getBreaker hits a timeout or failure, the fallback triggers.

    // Force failure by simulating an open breaker on redis:get
    const getBreaker = breakerRegistry.getAll().get('redis:get');
    if (getBreaker) {
      // Manually trip the breaker
      getBreaker.open();
      expect(getBreaker.opened).toBe(true);
      
      const result = await redisProxy.get('some-key');
      // Should not throw, returns null
      expect(result).toBeNull();
    }
  });

  it('BreakerRegistry.getStatus() reflects correct state after open/close events', async () => {
    const stub = sinon.stub().rejects(new Error('Fail'));
    const breaker = createBreaker('test-breaker-registry', stub, { volumeThreshold: 1 });
    breaker.fallback(() => 'fb');

    let status = breakerRegistry.getStatus().find(b => b.name === 'test-breaker-registry');
    expect(status?.state).toBe('CLOSED');

    await breaker.fire(); // Opens it

    status = breakerRegistry.getStatus().find(b => b.name === 'test-breaker-registry');
    expect(status?.state).toBe('OPEN');
  });
});
