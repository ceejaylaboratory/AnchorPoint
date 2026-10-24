import { createHmac, randomBytes } from 'crypto';

import prisma from '../lib/prisma';
import { config } from '../config/env';
import { hashPassword } from './password-hash.service';
import {
  type AdminEmailService,
  SmtpAdminEmailService,
} from './admin-email.service';

const RESET_TOKEN_BYTES = 32;

export class InvalidResetTokenError extends Error {
  constructor() {
    super('Invalid or expired reset token.');
    this.name = 'InvalidResetTokenError';
  }
}

function hashResetToken(token: string): string {
  return createHmac('sha256', config.JWT_SECRET).update(token).digest('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class AdminPasswordResetService {
  constructor(private readonly emailService: AdminEmailService = new SmtpAdminEmailService()) {}

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);

    const admin = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true },
    });

    if (!admin) {
      return;
    }

    const rawToken = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + config.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

    await prisma.$transaction(async (tx: any) => {
      await tx.adminPasswordResetToken.updateMany({
        where: {
          adminUserId: admin.id,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });

      await tx.adminPasswordResetToken.create({
        data: {
          adminUserId: admin.id,
          tokenHash,
          expiresAt,
        },
      });
    });

    try {
      await this.emailService.sendPasswordResetEmail({
        to: admin.email,
        token: rawToken,
        expiresAt,
      });
    } catch (error) {
      await prisma.adminPasswordResetToken.deleteMany({
        where: {
          tokenHash,
          usedAt: null,
        },
      });
      throw error;
    }
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const tokenHash = hashResetToken(token);

    const existingToken = await prisma.adminPasswordResetToken.findUnique({
      where: { tokenHash },
      include: { adminUser: true },
    });

    const now = Date.now();

    if (!existingToken || existingToken.usedAt || existingToken.expiresAt.getTime() <= now) {
      throw new InvalidResetTokenError();
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx: any) => {
      // Consume the token by deleting it. The conditional delete makes the
      // token single-use even if the same token is submitted concurrently:
      // only one request can remove the row.
      const consumed = await tx.adminPasswordResetToken.deleteMany({
        where: {
          id: existingToken.id,
          usedAt: null,
          expiresAt: { gt: new Date(now) },
        },
      });

      if (consumed.count !== 1) {
        throw new InvalidResetTokenError();
      }

      await tx.adminUser.update({
        where: { id: existingToken.adminUserId },
        data: { passwordHash },
      });

      // Invalidate every other outstanding reset token for this admin.
      await tx.adminPasswordResetToken.deleteMany({
        where: { adminUserId: existingToken.adminUserId },
      });
    });
  }
}
