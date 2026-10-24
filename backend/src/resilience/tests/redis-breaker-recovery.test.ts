import sinon from 'sinon';
import { breakerRegistry } from '../breaker-registry';
import {
  DEFAULT_REDIS_BREAKER_RESET_TIMEOUT_MS,
  RedisProxy,
  resolveRedisBreakerResetTimeout,
} from '../redis.proxy';

/** In-memory Redis stand-in that can be taken down and brought back. */
class FlakyRedis {
  down = false;
  calls = 0;
  private readonly store = new Map<string, string>();

  private async guard(): Promise<void> {
    this.calls += 1;
    if (this.down) {
      throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
    }
  }

  async get(key: string): Promise<string | null> {
    await this.guard();
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    await this.guard();
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    await this.guard();
    return this.store.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    await this.guard();
    return this.store.has(key) ? 1 : 0;
  }
}

const RESET_TIMEOUT_MS = 1000;

const breaker = (name: string) => {
  const found = breakerRegistry.getAll().get(name);
  if (!found) throw new Error(`breaker ${name} not registered`);
  return found;
};

describe('resolveRedisBreakerResetTimeout', () => {
  it('defaults when REDIS_BREAKER_RESET_TIMEOUT_MS is unset', () => {
    expect(resolveRedisBreakerResetTimeout({})).toBe(DEFAULT_REDIS_BREAKER_RESET_TIMEOUT_MS);
  });

  it('uses a configured positive integer', () => {
    expect(resolveRedisBreakerResetTimeout({ REDIS_BREAKER_RESET_TIMEOUT_MS: '5000' })).toBe(5000);
  });

  it.each(['0', '-1', 'abc', '1.5', '  '])('falls back to the default for invalid value %p', (value) => {
    expect(resolveRedisBreakerResetTimeout({ REDIS_BREAKER_RESET_TIMEOUT_MS: value })).toBe(
      DEFAULT_REDIS_BREAKER_RESET_TIMEOUT_MS
    );
  });
});

describe('RedisProxy circuit breaker recovery', () => {
  let clock: sinon.SinonFakeTimers;
  let client: FlakyRedis;
  let proxy: RedisProxy;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    client = new FlakyRedis();
    proxy = new RedisProxy(client, {
      resetTimeout: RESET_TIMEOUT_MS,
      volumeThreshold: 1,
      errorThresholdPercentage: 50,
    });
  });

  afterEach(() => {
    clock.restore();
  });

  const ALL_BREAKERS = ['redis:get', 'redis:set', 'redis:del', 'redis:exists'];

  const tripAll = async (target: RedisProxy) => {
    client.down = true;
    await target.get('k');
    await target.set('k', 'v');
    await target.del('k');
    await target.exists('k');
    for (const name of ALL_BREAKERS) {
      expect(breaker(name).opened).toBe(true);
    }
  };

  it('half-opens every Redis breaker after the configured resetTimeout', async () => {
    await tripAll(proxy);

    clock.tick(RESET_TIMEOUT_MS - 1);
    for (const name of ALL_BREAKERS) {
      expect(breaker(name).opened).toBe(true);
    }

    clock.tick(1);
    for (const name of ALL_BREAKERS) {
      expect(breaker(name).halfOpen).toBe(true);
    }
  });

  it('uses the env-derived resetTimeout when none is passed', async () => {
    const previous = process.env.REDIS_BREAKER_RESET_TIMEOUT_MS;
    process.env.REDIS_BREAKER_RESET_TIMEOUT_MS = '2500';
    try {
      const envProxy = new RedisProxy(client, { volumeThreshold: 1 });
      await tripAll(envProxy);

      clock.tick(2499);
      expect(breaker('redis:get').opened).toBe(true);
      clock.tick(1);
      expect(breaker('redis:get').halfOpen).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.REDIS_BREAKER_RESET_TIMEOUT_MS;
      else process.env.REDIS_BREAKER_RESET_TIMEOUT_MS = previous;
    }
  });

  it('opens on failure, half-opens after resetTimeout and closes once Redis reconnects', async () => {
    await proxy.set('k', 'v');

    // Redis goes away: the failure trips the breaker and the fallback is served.
    client.down = true;
    await expect(proxy.get('k')).resolves.toBeNull();
    expect(breaker('redis:get').opened).toBe(true);

    // While open, calls short-circuit without touching Redis.
    const callsWhileOpen = client.calls;
    await expect(proxy.get('k')).resolves.toBeNull();
    expect(client.calls).toBe(callsWhileOpen);

    // Redis reconnects, but the breaker stays open until resetTimeout elapses.
    client.down = false;
    clock.tick(RESET_TIMEOUT_MS - 1);
    await expect(proxy.get('k')).resolves.toBeNull();
    expect(breaker('redis:get').opened).toBe(true);

    clock.tick(1);
    expect(breaker('redis:get').halfOpen).toBe(true);

    // The probe succeeds and the breaker closes: real values flow again.
    await expect(proxy.get('k')).resolves.toBe('v');
    expect(breaker('redis:get').closed).toBe(true);
    await expect(proxy.get('k')).resolves.toBe('v');
  });

  it('re-opens when the half-open probe fails and recovers on a later probe', async () => {
    await proxy.set('k', 'v');
    client.down = true;
    await proxy.get('k');
    expect(breaker('redis:get').opened).toBe(true);

    // Probe while Redis is still down: breaker opens again.
    clock.tick(RESET_TIMEOUT_MS);
    expect(breaker('redis:get').halfOpen).toBe(true);
    await expect(proxy.get('k')).resolves.toBeNull();
    expect(breaker('redis:get').opened).toBe(true);

    // Redis comes back; the next probe after another resetTimeout closes it.
    client.down = false;
    clock.tick(RESET_TIMEOUT_MS);
    await expect(proxy.get('k')).resolves.toBe('v');
    expect(breaker('redis:get').closed).toBe(true);
  });

  it('recovers write and lookup breakers as well as reads', async () => {
    client.down = true;
    await expect(proxy.set('k', 'v')).resolves.toBe('OK');
    await expect(proxy.exists('k')).resolves.toBe(0);
    await expect(proxy.del('k')).resolves.toBe(0);
    for (const name of ['redis:set', 'redis:exists', 'redis:del']) {
      expect(breaker(name).opened).toBe(true);
    }

    client.down = false;
    clock.tick(RESET_TIMEOUT_MS);

    await proxy.set('k', 'v');
    await expect(proxy.exists('k')).resolves.toBe(1);
    await expect(proxy.del('k')).resolves.toBe(1);
    for (const name of ['redis:set', 'redis:exists', 'redis:del']) {
      expect(breaker(name).closed).toBe(true);
    }
  });
});
