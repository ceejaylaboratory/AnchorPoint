import express from 'express';
import request from 'supertest';

jest.mock('../../services/admin-password-reset.service', () => {
  const mockedService = {
    requestPasswordReset: jest.fn(),
    confirmPasswordReset: jest.fn(),
  };

  class MockInvalidResetTokenError extends Error {
    constructor() {
      super('Invalid or expired reset token.');
      this.name = 'InvalidResetTokenError';
    }
  }

  return {
    __esModule: true,
    __mockedService: mockedService,
    AdminPasswordResetService: jest.fn().mockImplementation(() => mockedService),
    InvalidResetTokenError: MockInvalidResetTokenError,
  };
});

jest.mock('../../services/sep31.service', () => ({
  __esModule: true,
  SEP31Service: jest.fn().mockImplementation(() => ({
    updateStatus: jest.fn(),
  })),
}));

jest.mock('../../services/sep31CallbackNotifier', () => ({
  __esModule: true,
  createCallbackNotifier: jest.fn().mockReturnValue({}),
}));

jest.mock('../../config/queue', () => ({
  __esModule: true,
  listNotificationDlqJobs: jest.fn(),
  retryNotificationDlqJob: jest.fn(),
}));

import adminRouter from './admin.route';
import { listNotificationDlqJobs, retryNotificationDlqJob } from '../../config/queue';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

describe('Admin password reset routes', () => {
  const mockedModule = jest.requireMock(
    '../../services/admin-password-reset.service'
  ) as {
    __mockedService: {
      requestPasswordReset: jest.Mock;
      confirmPasswordReset: jest.Mock;
    };
    InvalidResetTokenError: new () => Error;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for invalid email payload on request endpoint', async () => {
    const res = await request(app)
      .post('/api/admin/password-reset/request')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(mockedModule.__mockedService.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('returns generic success response for request endpoint', async () => {
    mockedModule.__mockedService.requestPasswordReset.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/admin/password-reset/request')
      .send({ email: 'admin@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('If an account exists for that email');
    expect(mockedModule.__mockedService.requestPasswordReset).toHaveBeenCalledWith('admin@example.com');
  });

  it('returns 400 for invalid confirm payload', async () => {
    const res = await request(app)
      .post('/api/admin/password-reset/confirm')
      .send({ token: 'short', newPassword: 'weak' });

    expect(res.status).toBe(400);
    expect(mockedModule.__mockedService.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid or expired reset token', async () => {
    mockedModule.__mockedService.confirmPasswordReset.mockRejectedValue(
      new mockedModule.InvalidResetTokenError()
    );

    const res = await request(app)
      .post('/api/admin/password-reset/confirm')
      .send({ token: 'a'.repeat(64), newPassword: 'StrongPassword123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid or expired reset token.');
  });

  it('resets password successfully with valid payload', async () => {
    mockedModule.__mockedService.confirmPasswordReset.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/admin/password-reset/confirm')
      .send({ token: 'a'.repeat(64), newPassword: 'StrongPassword123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password has been reset successfully.');
    expect(mockedModule.__mockedService.confirmPasswordReset).toHaveBeenCalledWith(
      'a'.repeat(64),
      'StrongPassword123'
    );
  });
});

describe('Admin notification DLQ routes (#1199)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists dead-lettered notification jobs', async () => {
    (listNotificationDlqJobs as jest.Mock).mockResolvedValue([
      { id: 'dlq-1', data: { name: 'send-email', originalJobId: 'job-1', failedReason: 'SMTP down' } },
    ]);

    const res = await request(app).get('/api/admin/queues/notification-dlq?start=0&end=9');

    expect(res.status).toBe(200);
    expect(listNotificationDlqJobs).toHaveBeenCalledWith(0, 9);
    expect(res.body.data).toEqual([
      { id: 'dlq-1', name: 'send-email', originalJobId: 'job-1', failedReason: 'SMTP down' },
    ]);
  });

  it('returns 400 for invalid pagination', async () => {
    const res = await request(app).get('/api/admin/queues/notification-dlq?start=-1');

    expect(res.status).toBe(400);
    expect(listNotificationDlqJobs).not.toHaveBeenCalled();
  });

  it('retries a dead-lettered notification job', async () => {
    (retryNotificationDlqJob as jest.Mock).mockResolvedValue({ id: 'job-2' });

    const res = await request(app).post('/api/admin/queues/notification-dlq/dlq-1/retry');

    expect(res.status).toBe(200);
    expect(retryNotificationDlqJob).toHaveBeenCalledWith('dlq-1');
    expect(res.body.data).toEqual({ jobId: 'job-2' });
  });

  it('returns 404 when the DLQ job does not exist', async () => {
    (retryNotificationDlqJob as jest.Mock).mockResolvedValue(null);

    const res = await request(app).post('/api/admin/queues/notification-dlq/missing/retry');

    expect(res.status).toBe(404);
  });
});
