import { pingHeartbeat } from './heartbeat';
import logger from '../utils/logger';

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('pingHeartbeat', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('pings the monitor URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await pingHeartbeat('transaction-reconcile', 'https://hc-ping.com/abc');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hc-ping.com/abc',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does nothing when no URL is configured', async () => {
    await pingHeartbeat('transaction-reconcile', undefined);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs and resolves when the monitor rejects the ping', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(pingHeartbeat('upload-expiry', 'https://hc-ping.com/abc')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('Heartbeat ping rejected', {
      job: 'upload-expiry',
      status: 503,
    });
  });

  it('does not throw when the ping fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(pingHeartbeat('fee-report-daily', 'https://hc-ping.com/abc')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('Heartbeat ping failed', {
      job: 'fee-report-daily',
      error: 'network down',
    });
  });
});
