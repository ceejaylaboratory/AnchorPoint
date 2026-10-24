import express from 'express';
import request from 'supertest';

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    adminUser: { findFirst: jest.fn() },
    feeSchedule: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    transaction: { findMany: jest.fn(), count: jest.fn() },
  },
}));

jest.mock('../../api/middleware/auth.middleware', () => {
  const actual = jest.requireActual('../../api/middleware/auth.middleware');
  return {
    ...actual,
    requireRole: () => (req: any, _res: any, next: any) => {
      req.admin = { id: 'admin-1', email: 'admin@example.com', role: 'SUPER_ADMIN' };
      next();
    },
  };
});

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
import prisma from '../../lib/prisma';

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

describe('Admin versioned fee schedule routes (#1348)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds a new fee version with a future effective date', async () => {
    const futureDate = new Date(Date.now() + 86400 * 1000 * 14).toISOString();
    const createdSchedule = {
      id: 'sched-101',
      assetCode: 'USDC',
      feeType: 'flat',
      feeFixed: 0.75,
      feePercent: 0,
      feeMinimum: 0,
      effectiveFrom: new Date(futureDate),
    };

    (prisma.feeSchedule.create as jest.Mock).mockResolvedValue(createdSchedule);

    const res = await request(app)
      .post('/api/admin/fees/schedule')
      .send({
        assetCode: 'USDC',
        feeType: 'flat',
        feeFixed: 0.75,
        effectiveFrom: futureDate,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.id).toBe('sched-101');
    expect(prisma.feeSchedule.create).toHaveBeenCalled();
  });

  it('rejects adding a fee version when effectiveFrom is in the past', async () => {
    const pastDate = new Date(Date.now() - 86400 * 1000).toISOString();

    const res = await request(app)
      .post('/api/admin/fees/schedule')
      .send({
        assetCode: 'USDC',
        feeType: 'flat',
        feeFixed: 0.75,
        effectiveFrom: pastDate,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prisma.feeSchedule.create).not.toHaveBeenCalled();
  });

  it('rejects adding a fee version with invalid feeType', async () => {
    const futureDate = new Date(Date.now() + 86400 * 1000).toISOString();

    const res = await request(app)
      .post('/api/admin/fees/schedule')
      .send({
        assetCode: 'USDC',
        feeType: 'invalid_type',
        feeFixed: 0.75,
        effectiveFrom: futureDate,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lists versioned fee schedules', async () => {
    const schedules = [
      { id: 'sched-1', assetCode: 'USDC', feeType: 'flat', feeFixed: 0.5 },
      { id: 'sched-2', assetCode: 'USDC', feeType: 'percentage', feePercent: 0.01 },
    ];
    (prisma.feeSchedule.findMany as jest.Mock).mockResolvedValue(schedules);

    const res = await request(app).get('/api/admin/fees/schedules?asset=USDC');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveLength(2);
    expect(prisma.feeSchedule.findMany).toHaveBeenCalledWith({
      where: { assetCode: 'USDC' },
      orderBy: { effectiveFrom: 'desc' },
    });
  });
});

describe('Admin TOTP MFA routes (#1347)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 on /api/admin/mfa/setup when unauthenticated', async () => {
    const res = await request(app).post('/api/admin/mfa/setup');
    expect(res.status).toBe(401);
  });

  it('returns 401 on /api/admin/mfa/confirm when unauthenticated', async () => {
    const res = await request(app).post('/api/admin/mfa/confirm').send({ code: '123456' });
    expect(res.status).toBe(401);
  });

  it('returns 400 on /api/admin/login for invalid payload', async () => {
    const res = await request(app).post('/api/admin/login').send({ email: 'invalid-email' });
    expect(res.status).toBe(400);
  });
});
