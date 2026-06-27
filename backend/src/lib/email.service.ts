import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import logger from '../utils/logger';

export interface EmailPayload {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
}

async function sendViaSendGrid(payload: EmailPayload): Promise<void> {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
  await sgMail.send({
    to: payload.to,
    from: payload.from,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
}

async function sendViaNodemailer(payload: EmailPayload): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: payload.from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (process.env.SENDGRID_API_KEY) {
    try {
      await sendViaSendGrid(payload);
      logger.debug('Email sent via SendGrid', { to: payload.to });
      return;
    } catch (err: unknown) {
      logger.warn('SendGrid delivery failed, falling back to Nodemailer', {
        to: payload.to,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (process.env.SMTP_HOST) {
    await sendViaNodemailer(payload);
    logger.debug('Email sent via Nodemailer', { to: payload.to });
    return;
  }

  logger.info('No email transport configured; email not sent', { to: payload.to, subject: payload.subject });
}
