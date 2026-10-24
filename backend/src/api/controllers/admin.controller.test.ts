import express from 'express';
import request from 'supertest';
import prisma from '../../lib/prisma';
import { hashPassword } from '../../services/password-hash.service';
import { signAccessToken } from '../../services/auth.service';
import {
  generateTotpCode,
  AdminMfaService,
} from '../../services/admin-mfa.service';
import { AdminController } from './admin.controller';
import { requireRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { adminMfaConfirmSchema, adminLoginSchema } from '../routes/admin.schemas';

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    adminUser: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    adminConfigAuditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  },
}));

describe('Admin TOTP MFA Controller & Service (#1347)', () => {
  const mockedPrisma = prisma as unknown as {
    adminUser: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    adminConfigAuditLog: {
      create: jest.Mock;
    };
  };

  let adminRecord: {
    id: string;
    email: string;
    passwordHash: string;
    role: 'SUPER_ADMIN' | 'OPS' | 'READ_ONLY';
    mfaEnabled: boolean;
    mfaSecret: string | null;
    mfaBackupCodes: string | null;
  };

  let app: express.Express;
  let adminToken: string;

  beforeAll(async () => {
    const hashedPassword = await hashPassword('AdminSecurePassword123!');
    adminRecord = {
      id: 'admin-uuid-1',
      email: 'admin@anchorpoint.io',
      passwordHash: hashedPassword,
      role: 'SUPER_ADMIN',
      mfaEnabled: false,
      mfaSecret: null,
      mfaBackupCodes: null,
    };
    adminToken = signAccessToken(adminRecord.id);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset admin state before each test
    adminRecord.mfaEnabled = false;
    adminRecord.mfaSecret = null;
    adminRecord.mfaBackupCodes = null;

    mockedPrisma.adminUser.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === adminRecord.id || where.email === adminRecord.email) {
        return { ...adminRecord };
      }
      return null;
    });

    mockedPrisma.adminUser.findFirst.mockImplementation(async ({ where }: any) => {
      const matches = where?.OR?.some(
        (cond: any) => cond.id === adminRecord.id || cond.email === adminRecord.email
      );
      if (matches) {
        return {
          id: adminRecord.id,
          email: adminRecord.email,
          role: adminRecord.role,
        };
      }
      return null;
    });

    mockedPrisma.adminUser.update.mockImplementation(async ({ where, data }: any) => {
      if (where.id === adminRecord.id) {
        adminRecord = {
          ...adminRecord,
          ...data,
        };
        return { ...adminRecord };
      }
      throw new Error('Admin not found');
    });

    const controller = new AdminController(new AdminMfaService());
    const requireAuth = requireRole('SUPER_ADMIN', 'OPS', 'READ_ONLY');

    app = express();
    app.use(express.json());
    app.post('/api/admin/login', validate({ body: adminLoginSchema }), controller.login);
    app.post('/api/admin/mfa/setup', requireAuth, controller.setupMfa);
    app.post(
      '/api/admin/mfa/confirm',
      requireAuth,
      validate({ body: adminMfaConfirmSchema }),
      controller.confirmMfa
    );
  });

  it('POST /api/admin/mfa/setup returns TOTP secret, QR code, and 10 single-use backup codes', async () => {
    const res = await request(app)
      .post('/api/admin/mfa/setup')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(typeof res.body.secret).toBe('string');
    expect(res.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(typeof res.body.qrCode).toBe('string');
    expect(res.body.qrCode.startsWith('data:image/')).toBe(true);
    expect(res.body.otpauthUrl).toContain('otpauth://totp/');
    expect(Array.isArray(res.body.backupCodes)).toBe(true);
    expect(res.body.backupCodes).toHaveLength(10);
    expect(new Set(res.body.backupCodes).size).toBe(10);

    // Ensure secret was stored but MFA is not yet enabled until confirmed
    expect(adminRecord.mfaSecret).toBe(res.body.secret);
    expect(adminRecord.mfaEnabled).toBe(false);
    expect(JSON.parse(adminRecord.mfaBackupCodes!)).toHaveLength(10);
  });

  it('POST /api/admin/mfa/confirm verifies first TOTP code and enables MFA', async () => {
    // 1. Setup MFA
    const setupRes = await request(app)
      .post('/api/admin/mfa/setup')
      .set('Authorization', `Bearer ${adminToken}`);

    const secret: string = setupRes.body.secret;
    const validTotpCode = generateTotpCode(secret);

    // 2. Confirm with valid TOTP code
    const confirmRes = await request(app)
      .post('/api/admin/mfa/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: validTotpCode });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('success');
    expect(confirmRes.body.mfaEnabled).toBe(true);
    expect(adminRecord.mfaEnabled).toBe(true);
  });

  it('POST /api/admin/mfa/confirm rejects invalid TOTP code and keeps MFA disabled', async () => {
    await request(app)
      .post('/api/admin/mfa/setup')
      .set('Authorization', `Bearer ${adminToken}`);

    const confirmRes = await request(app)
      .post('/api/admin/mfa/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '000000' });

    expect(confirmRes.status).toBe(400);
    expect(confirmRes.body.status).toBe('error');
    expect(adminRecord.mfaEnabled).toBe(false);
  });

  it('login succeeds with valid TOTP code when MFA is enabled', async () => {
    // Setup and confirm MFA
    const setupRes = await request(app)
      .post('/api/admin/mfa/setup')
      .set('Authorization', `Bearer ${adminToken}`);
    const secret: string = setupRes.body.secret;

    await request(app)
      .post('/api/admin/mfa/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: generateTotpCode(secret) });

    // Attempt login without TOTP code -> should fail with 401 MFA_REQUIRED
    const missingCodeRes = await request(app)
      .post('/api/admin/login')
      .send({
        email: adminRecord.email,
        password: 'AdminSecurePassword123!',
      });

    expect(missingCodeRes.status).toBe(401);
    expect(missingCodeRes.body.code).toBe('MFA_REQUIRED');
    expect(missingCodeRes.body.mfaRequired).toBe(true);

    // Login with valid TOTP code -> should succeed and return JWT
    const validCode = generateTotpCode(secret);
    const loginRes = await request(app)
      .post('/api/admin/login')
      .send({
        email: adminRecord.email,
        password: 'AdminSecurePassword123!',
        totpCode: validCode,
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.status).toBe('success');
    expect(typeof loginRes.body.token).toBe('string');
    expect(loginRes.body.admin.email).toBe(adminRecord.email);
    expect(loginRes.body.admin.mfaEnabled).toBe(true);
  });

  it('login fails with expired TOTP code when MFA is enabled', async () => {
    // Setup and confirm MFA
    const setupRes = await request(app)
      .post('/api/admin/mfa/setup')
      .set('Authorization', `Bearer ${adminToken}`);
    const secret: string = setupRes.body.secret;

    await request(app)
      .post('/api/admin/mfa/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: generateTotpCode(secret) });

    // Generate a code from 5 minutes ago (expired well outside the ±1 step window)
    const fiveMinutesAgoMs = Date.now() - 5 * 60 * 1000;
    const expiredCode = generateTotpCode(secret, fiveMinutesAgoMs);

    const loginRes = await request(app)
      .post('/api/admin/login')
      .send({
        email: adminRecord.email,
        password: 'AdminSecurePassword123!',
        totpCode: expiredCode,
      });

    expect(loginRes.status).toBe(401);
    expect(loginRes.body.status).toBe('error');
    expect(loginRes.body.code).toBe('INVALID_TOTP_CODE');
  });

  it('allows single-use backup code for login and rejects reuse of the same backup code', async () => {
    const setupRes = await request(app)
      .post('/api/admin/mfa/setup')
      .set('Authorization', `Bearer ${adminToken}`);
    const secret: string = setupRes.body.secret;
    const backupCodes: string[] = setupRes.body.backupCodes;

    await request(app)
      .post('/api/admin/mfa/confirm')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: generateTotpCode(secret) });

    const firstBackupCode = backupCodes[0];

    // First use succeeds
    const firstLogin = await request(app)
      .post('/api/admin/login')
      .send({
        email: adminRecord.email,
        password: 'AdminSecurePassword123!',
        totpCode: firstBackupCode,
      });

    expect(firstLogin.status).toBe(200);
    expect(firstLogin.body.token).toBeDefined();
    expect(JSON.parse(adminRecord.mfaBackupCodes!)).toHaveLength(9);

    // Second use of the same backup code is rejected
    const secondLogin = await request(app)
      .post('/api/admin/login')
      .send({
        email: adminRecord.email,
        password: 'AdminSecurePassword123!',
        totpCode: firstBackupCode,
      });

    expect(secondLogin.status).toBe(401);
    expect(secondLogin.body.code).toBe('INVALID_TOTP_CODE');
  });
});
