import { createHmac } from 'crypto';

import prisma from '../lib/prisma';
import { config } from '../config/env';
import {
  AdminPasswordResetService,
  InvalidResetTokenError,
} from './admin-password-reset.service';
import { hashPassword } from './password-hash.service';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    adminUser: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    adminPasswordResetToken: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('./password-hash.service', () => ({
  hashPassword: jest.fn(),
}));

describe('AdminPasswordResetService', () => {
  const mockedPrisma = prisma as unknown as {
    adminUser: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    adminPasswordResetToken: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUnique: jest.Mock;
      deleteMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const emailService = {
    sendPasswordResetEmail: jest.fn(),
  };

  const nowSpy = jest.spyOn(Date, 'now');

  beforeEach(() => {
    jest.clearAllMocks();
    nowSpy.mockReturnValue(new Date('2026-04-26T10:00:00.000Z').getTime());
    mockedPrisma.$transaction.mockImplementation(async (callback: any) =>
      callback(mockedPrisma)
    );
  });

  afterAll(() => {
    nowSpy.mockRestore();
  });

  it('creates and emails a reset token for existing admin user', async () => {
    mockedPrisma.adminUser.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
    });

    const service = new AdminPasswordResetService(emailService);
    await service.requestPasswordReset('ADMIN@example.com');

    expect(mockedPrisma.adminUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
      select: { id: true, email: true },
    });

    expect(mockedPrisma.adminPasswordResetToken.create).toHaveBeenCalledTimes(1);
    const createCall = mockedPrisma.adminPasswordResetToken.create.mock.calls[0][0];

    const sentToken = emailService.sendPasswordResetEmail.mock.calls[0][0].token as string;
    const expectedHash = createHmac('sha256', config.JWT_SECRET)
      .update(sentToken)
      .digest('hex');

    expect(createCall.data.adminUserId).toBe('admin-1');
    expect(createCall.data.tokenHash).toBe(expectedHash);
    expect(createCall.data.expiresAt.toISOString()).toBe('2026-04-26T10:15:00.000Z');
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('returns silently for unknown admin email', async () => {
    mockedPrisma.adminUser.findUnique.mockResolvedValue(null);

    const service = new AdminPasswordResetService(emailService);
    await service.requestPasswordReset('missing@example.com');

    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(mockedPrisma.adminPasswordResetToken.create).not.toHaveBeenCalled();
  });

  it('throws InvalidResetTokenError when token cannot be found', async () => {
    mockedPrisma.adminPasswordResetToken.findUnique.mockResolvedValue(null);

    const service = new AdminPasswordResetService(emailService);

    await expect(
      service.confirmPasswordReset('raw-token', 'StrongPassword123')
    ).rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('throws InvalidResetTokenError when token is expired', async () => {
    mockedPrisma.adminPasswordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      adminUserId: 'admin-1',
      usedAt: null,
      expiresAt: new Date('2026-04-26T09:59:59.000Z'),
      adminUser: { id: 'admin-1' },
    });

    const service = new AdminPasswordResetService(emailService);

    await expect(
      service.confirmPasswordReset('raw-token', 'StrongPassword123')
    ).rejects.toBeInstanceOf(InvalidResetTokenError);
  });

  it('updates password and deletes the used token and all other tokens for the admin', async () => {
    mockedPrisma.adminPasswordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      adminUserId: 'admin-1',
      usedAt: null,
      expiresAt: new Date('2026-04-26T10:30:00.000Z'),
      adminUser: { id: 'admin-1' },
    });
    mockedPrisma.adminPasswordResetToken.deleteMany.mockResolvedValue({ count: 1 });

    (hashPassword as jest.Mock).mockResolvedValue('hashed-password');

    const service = new AdminPasswordResetService(emailService);
    await service.confirmPasswordReset('raw-token', 'StrongPassword123');

    expect(hashPassword).toHaveBeenCalledWith('StrongPassword123');
    expect(mockedPrisma.adminUser.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: { passwordHash: 'hashed-password' },
    });
    expect(mockedPrisma.adminPasswordResetToken.deleteMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'reset-1',
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
    });
    expect(mockedPrisma.adminPasswordResetToken.deleteMany).toHaveBeenNthCalledWith(2, {
      where: { adminUserId: 'admin-1' },
    });
    // Tokens are removed, not merely flagged as used.
    expect(mockedPrisma.adminPasswordResetToken.update).not.toHaveBeenCalled();
    expect(mockedPrisma.adminPasswordResetToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects the token and leaves the password unchanged when it was consumed concurrently', async () => {
    mockedPrisma.adminPasswordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      adminUserId: 'admin-1',
      usedAt: null,
      expiresAt: new Date('2026-04-26T10:30:00.000Z'),
      adminUser: { id: 'admin-1' },
    });
    // Another request deleted the token between the lookup and the transaction.
    mockedPrisma.adminPasswordResetToken.deleteMany.mockResolvedValue({ count: 0 });
    (hashPassword as jest.Mock).mockResolvedValue('hashed-password');

    const service = new AdminPasswordResetService(emailService);

    await expect(
      service.confirmPasswordReset('raw-token', 'StrongPassword123')
    ).rejects.toBeInstanceOf(InvalidResetTokenError);
    expect(mockedPrisma.adminUser.update).not.toHaveBeenCalled();
  });

  describe('regression: reset token reuse (stateful token table)', () => {
    type TokenRow = {
      id: string;
      adminUserId: string;
      tokenHash: string;
      usedAt: Date | null;
      expiresAt: Date;
    };

    let tokens: TokenRow[];

    const hashOf = (raw: string) => createHmac('sha256', config.JWT_SECRET).update(raw).digest('hex');

    beforeEach(() => {
      tokens = [
        {
          id: 'reset-1',
          adminUserId: 'admin-1',
          tokenHash: hashOf('token-a'),
          usedAt: null,
          expiresAt: new Date('2026-04-26T10:30:00.000Z'),
        },
        {
          id: 'reset-2',
          adminUserId: 'admin-1',
          tokenHash: hashOf('token-b'),
          usedAt: null,
          expiresAt: new Date('2026-04-26T10:30:00.000Z'),
        },
        {
          id: 'reset-3',
          adminUserId: 'admin-2',
          tokenHash: hashOf('token-c'),
          usedAt: null,
          expiresAt: new Date('2026-04-26T10:30:00.000Z'),
        },
      ];

      mockedPrisma.adminPasswordResetToken.findUnique.mockImplementation(
        async ({ where }: { where: { tokenHash: string } }) => {
          const row = tokens.find((t) => t.tokenHash === where.tokenHash);
          return row ? { ...row, adminUser: { id: row.adminUserId } } : null;
        }
      );

      mockedPrisma.adminPasswordResetToken.deleteMany.mockImplementation(
        async ({ where }: { where: { id?: string; adminUserId?: string; usedAt?: null; expiresAt?: { gt: Date } } }) => {
          const matches = (t: TokenRow) =>
            (where.id === undefined || t.id === where.id) &&
            (where.adminUserId === undefined || t.adminUserId === where.adminUserId) &&
            (where.usedAt === undefined || t.usedAt === null) &&
            (where.expiresAt === undefined || t.expiresAt.getTime() > where.expiresAt.gt.getTime());
          const before = tokens.length;
          tokens = tokens.filter((t) => !matches(t));
          return { count: before - tokens.length };
        }
      );

      (hashPassword as jest.Mock).mockResolvedValue('hashed-password');
    });

    it('cannot reuse the same token after a successful reset', async () => {
      const service = new AdminPasswordResetService(emailService);

      await service.confirmPasswordReset('token-a', 'StrongPassword123');
      expect(mockedPrisma.adminUser.update).toHaveBeenCalledTimes(1);

      await expect(
        service.confirmPasswordReset('token-a', 'AnotherPassword456')
      ).rejects.toBeInstanceOf(InvalidResetTokenError);
      expect(mockedPrisma.adminUser.update).toHaveBeenCalledTimes(1);
    });

    it('invalidates other outstanding tokens for the same admin only', async () => {
      const service = new AdminPasswordResetService(emailService);

      await service.confirmPasswordReset('token-a', 'StrongPassword123');

      expect(tokens.map((t) => t.id)).toEqual(['reset-3']);
      await expect(
        service.confirmPasswordReset('token-b', 'AnotherPassword456')
      ).rejects.toBeInstanceOf(InvalidResetTokenError);
    });
  });
});
