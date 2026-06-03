import { config } from '../config/env';
import { renderHotWalletLowBalanceAlert, renderSystemAlert } from '../lib/email/alert-email.templates';
import type { SystemAlertTemplateInput } from '../lib/email/alert-email.templates';
import {
  createSmtpTransporter,
  isSmtpConfigured,
  parseEmailRecipients,
} from '../lib/smtp/create-transporter';
import type { AlertPayload } from '../types/alerts';
import logger from '../utils/logger';

export interface AlertEmailService {
  sendHotWalletLowBalanceAlert(recipients: string, alert: AlertPayload): Promise<void>;
  sendSystemAlert(recipients: string, alert: SystemAlertTemplateInput): Promise<void>;
}

export class SmtpAlertEmailService implements AlertEmailService {
  async sendHotWalletLowBalanceAlert(recipients: string, alert: AlertPayload): Promise<void> {
    const content = renderHotWalletLowBalanceAlert(alert);
    await this.sendAlertEmail(recipients, content, {
      logContext: 'hot wallet low balance',
      walletLabel: alert.walletLabel,
    });
  }

  async sendSystemAlert(recipients: string, alert: SystemAlertTemplateInput): Promise<void> {
    const content = renderSystemAlert(alert);
    await this.sendAlertEmail(recipients, content, {
      logContext: 'system alert',
      metric: alert.metric,
    });
  }

  private async sendAlertEmail(
    recipients: string,
    content: { subject: string; text: string; html: string },
    metadata: Record<string, string>,
  ): Promise<void> {
    const to = parseEmailRecipients(recipients);

    if (to.length === 0) {
      logger.warn('[AlertEmail] No valid email recipients provided', metadata);
      return;
    }

    if (!isSmtpConfigured()) {
      logger.info('[AlertEmail] SMTP not configured; alert logged for development', {
        ...metadata,
        to,
        subject: content.subject,
      });
      return;
    }

    const transporter = createSmtpTransporter();

    await transporter.sendMail({
      from: config.SMTP_FROM!,
      to: to.join(', '),
      subject: content.subject,
      text: content.text,
      html: content.html,
    });

    logger.info('[AlertEmail] Alert email sent', { ...metadata, to, subject: content.subject });
  }
}

export const alertEmailService = new SmtpAlertEmailService();
