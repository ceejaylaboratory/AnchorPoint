import { queueConnection } from './queue';

describe('BullMQ queue connection resiliency (#361)', () => {
  it('has maxRetriesPerRequest set to null for BullMQ compatibility', () => {
    expect(queueConnection.maxRetriesPerRequest).toBeNull();
  });

  it('has enableReadyCheck disabled', () => {
    expect(queueConnection.enableReadyCheck).toBe(false);
  });

  it('retryStrategy returns capped delay', () => {
    const strategy = queueConnection.retryStrategy as (times: number) => number;
    expect(strategy(1)).toBe(100);
    expect(strategy(10)).toBe(1000);
    expect(strategy(100)).toBe(5000);
  });

  it('reconnectOnError returns true for READONLY errors', () => {
    const fn = queueConnection.reconnectOnError as (err: Error) => boolean;
    expect(fn(new Error('READONLY command not allowed'))).toBe(true);
  });

  it('reconnectOnError returns true for ECONNRESET errors', () => {
    const fn = queueConnection.reconnectOnError as (err: Error) => boolean;
    expect(fn(new Error('ECONNRESET'))).toBe(true);
  });

  it('reconnectOnError returns false for unrelated errors', () => {
    const fn = queueConnection.reconnectOnError as (err: Error) => boolean;
    expect(fn(new Error('WRONGTYPE'))).toBe(false);
  });
});
