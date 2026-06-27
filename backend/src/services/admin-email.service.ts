import { config } from '../config/env';
import logger from '../utils/logger';
import { sendEmail } from '../lib/email.service';

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

    if (!config.SMTP_HOST && !process.env.SENDGRID_API_KEY) {
      logger.info('No email transport configured; password reset email logged for development', {
        to: input.to,
        resetUrl,
        expiresAt: input.expiresAt.toISOString(),
      });
      return;
    }

    await sendEmail({
      from: config.SMTP_FROM || 'noreply@anchorpoint.app',
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
