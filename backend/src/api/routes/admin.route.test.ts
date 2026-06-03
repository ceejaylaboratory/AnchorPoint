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

import adminRouter from './admin.route';

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
