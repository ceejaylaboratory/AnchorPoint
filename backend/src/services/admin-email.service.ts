import nodemailer from 'nodemailer';

import { config } from '../config/env';
import logger from '../utils/logger';

export interface PasswordResetEmailInput {
  to: string;
  token: string;
  expiresAt: Date;
}

export interface AdminEmailService {
  sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void>;
}

export class SmtpAdminEmailService implements AdminEmailService {
  async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    const resetUrl = `${config.ADMIN_PASSWORD_RESET_URL_BASE}?token=${encodeURIComponent(input.token)}`;

    if (!config.SMTP_HOST || !config.SMTP_PORT || !config.SMTP_FROM) {
      logger.info('SMTP not configured; password reset email logged for development', {
        to: input.to,
        resetUrl,
        expiresAt: input.expiresAt.toISOString(),
      });
      return;
    }

    const transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? {
              user: config.SMTP_USER,
              pass: config.SMTP_PASS,
            }
          : undefined,
    });

    await transporter.sendMail({
      from: config.SMTP_FROM,
      to: input.to,
      subject: 'AnchorPoint Admin Password Reset',
      text: [
        'You requested a password reset for your AnchorPoint admin account.',
        `Reset link: ${resetUrl}`,
        `This link expires at ${input.expiresAt.toISOString()}.`,
        'If you did not request this, you can ignore this message.',
      ].join('\n'),
      html: `
        <p>You requested a password reset for your AnchorPoint admin account.</p>
        <p><a href="${resetUrl}">Reset password</a></p>
        <p>This link expires at <strong>${input.expiresAt.toISOString()}</strong>.</p>
        <p>If you did not request this, you can ignore this message.</p>
      `,
    });
  }
}
