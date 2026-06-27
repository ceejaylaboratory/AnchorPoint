import nodemailer, { type Transporter } from 'nodemailer';

import { config } from '../../config/env';

export function isSmtpConfigured(): boolean {
  return Boolean(config.SMTP_HOST && config.SMTP_PORT && config.SMTP_FROM);
}

export function createSmtpTransporter(): Transporter {
  if (!isSmtpConfigured()) {
    throw new Error('SMTP is not configured');
  }

  return nodemailer.createTransport({
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
}

export function parseEmailRecipients(recipients: string): string[] {
  return recipients
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
}
