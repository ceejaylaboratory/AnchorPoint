import { Response } from 'express';
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  EventDispatcherService,
} from './event-dispatcher.service';
import { metricsService } from './metrics.service';

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const makeResponse = () => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    write: jest.fn(),
    once: jest.fn((event: string, cb: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    }),
    removeListener: jest.fn((event: string, cb: () => void) => {
      listeners.get(event)?.delete(cb);
    }),
    trigger: (event: string) => listeners.get(event)?.forEach((cb) => cb()),
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  };
};

describe('EventDispatcherService (#1581)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('clears the heartbeat timer and removes response listeners on unsubscribe', () => {
    const dispatcher = new EventDispatcherService();
    const res = makeResponse();
    const increment = jest.spyOn(metricsService, 'incrementSseConnections');
    const decrement = jest.spyOn(metricsService, 'decrementSseConnections');

    const unsubscribe = dispatcher.subscribe(res as unknown as Response);
    expect(dispatcher.getSubscriberCount()).toBe(1);
    expect(increment).toHaveBeenCalledTimes(1);
    expect(res.once).toHaveBeenCalledWith('close', expect.any(Function));
    expect(res.once).toHaveBeenCalledWith('error', expect.any(Function));

    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    unsubscribe();
    unsubscribe();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(res.removeListener).toHaveBeenCalledWith('close', expect.any(Function));
    expect(res.removeListener).toHaveBeenCalledWith('error', expect.any(Function));
    expect(dispatcher.getSubscriberCount()).toBe(0);
    expect(decrement).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS);
    expect(res.write).not.toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
    increment.mockRestore();
    decrement.mockRestore();
  });

  it('drops a client and stops its timer when a heartbeat write fails', () => {
    const dispatcher = new EventDispatcherService();
    const res = makeResponse();
    res.write.mockImplementation(() => {
      throw new Error('socket closed');
    });
    const decrement = jest.spyOn(metricsService, 'decrementSseConnections');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    dispatcher.subscribe(res as unknown as Response);
    jest.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS);

    expect(dispatcher.getSubscriberCount()).toBe(0);
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(decrement).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS * 3);
    expect(res.write).toHaveBeenCalledTimes(1);
    clearIntervalSpy.mockRestore();
    decrement.mockRestore();
  });

  it('unsubscribes automatically when the response emits close', () => {
    const dispatcher = new EventDispatcherService();
    const res = makeResponse();
    const decrement = jest.spyOn(metricsService, 'decrementSseConnections');

    dispatcher.subscribe(res as unknown as Response);
    res.trigger('close');

    expect(dispatcher.getSubscriberCount()).toBe(0);
    expect(decrement).toHaveBeenCalledTimes(1);
    decrement.mockRestore();
  });
});
