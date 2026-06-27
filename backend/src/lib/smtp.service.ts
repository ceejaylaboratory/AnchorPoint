import nodemailer, { Transporter } from 'nodemailer';

import { config } from '../config/env';
import logger from '../utils/logger';

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

export class SmtpService {
  private static instance: SmtpService;
  private transporter: Transporter | null = null;

  private constructor() {}

  static getInstance(): SmtpService {
    if (!SmtpService.instance) {
      SmtpService.instance = new SmtpService();
    }
    return SmtpService.instance;
  }

  isConfigured(): boolean {
    return Boolean(config.SMTP_HOST && config.SMTP_PORT && config.SMTP_FROM);
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
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

    return this.transporter;
  }

  async sendMail(options: SendMailOptions): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.info('SMTP not configured; email logged for development', {
        to: options.to,
        subject: options.subject,
      });
      return false;
    }

    try {
      await this.getTransporter().sendMail({
        from: config.SMTP_FROM,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      logger.info('Email sent via SMTP', {
        to: options.to,
        subject: options.subject,
      });
      return true;
    } catch (error) {
      logger.error('Failed to send email via SMTP', {
        to: options.to,
        subject: options.subject,
        error,
      });
      throw error;
    }
  }
}

export const smtpService = SmtpService.getInstance();
