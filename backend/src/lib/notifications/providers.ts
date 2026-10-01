import sgMail from "@sendgrid/mail";
import {
  NotificationProvider,
  NotificationType,
} from "../../services/notification.service";
import { smtpService } from "../smtp.service";
import logger from "../../utils/logger";
import https from "https";

const NOTIFICATION_SUBJECT = "AnchorPoint Notification";

export class SmtpEmailProvider implements NotificationProvider {
  async send(to: string, message: string): Promise<boolean> {
    return smtpService.sendMail({
      to,
      subject: NOTIFICATION_SUBJECT,
      text: message,
    });
  }
}

/** Email via SendGrid. Enabled by SENDGRID_API_KEY; sender from SENDGRID_FROM (falls back to SMTP_FROM). */
export class SendGridEmailProvider implements NotificationProvider {
  static isConfigured(): boolean {
    return Boolean(
      process.env.SENDGRID_API_KEY &&
        (process.env.SENDGRID_FROM || process.env.SMTP_FROM),
    );
  }

  async send(to: string, message: string): Promise<boolean> {
    try {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
      await sgMail.send({
        to,
        from: (process.env.SENDGRID_FROM || process.env.SMTP_FROM)!,
        subject: NOTIFICATION_SUBJECT,
        text: message,
      });
      return true;
    } catch (error) {
      logger.error("SendGrid email notification failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

export class ConsoleEmailProvider implements NotificationProvider {
  async send(to: string, message: string): Promise<boolean> {
    logger.info(`[MOCK EMAIL] To: ${to} | Message: ${message}`);
    return true;
  }
}

export class ConsoleSmsProvider implements NotificationProvider {
  async send(to: string, message: string): Promise<boolean> {
    logger.info(`[MOCK SMS] To: ${to} | Message: ${message}`);
    return true;
  }
}

/**
 * SMS via the Twilio Messages REST API. Enabled by TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.
 */
export class TwilioSmsProvider implements NotificationProvider {
  static isConfigured(): boolean {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_FROM_NUMBER,
    );
  }

  async send(to: string, message: string): Promise<boolean> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!accountSid || !authToken || !from) {
      logger.warn("Twilio not configured, SMS notification not sent");
      return false;
    }

    const body = new URLSearchParams({ To: to, From: from, Body: message }).toString();
    const options = {
      hostname: "api.twilio.com",
      port: 443,
      path: `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const ok = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) {
            logger.error(`Twilio SMS notification failed: ${res.statusCode} ${data}`);
          }
          resolve(ok);
        });
      });

      req.on("error", (error) => {
        logger.error("Twilio SMS notification error:", error);
        resolve(false);
      });

      req.write(body);
      req.end();
    });
  }
}

export class ConsolePushProvider implements NotificationProvider {
  async send(to: string, message: string): Promise<boolean> {
    logger.info(`[MOCK PUSH] To: ${to} | Message: ${message}`);
    return true;
  }
}

export class FcmPushProvider implements NotificationProvider {
  async send(to: string, message: string): Promise<boolean> {
    try {
      const fcmServerKey = process.env.FCM_SERVER_KEY;
      if (!fcmServerKey) {
        logger.warn("FCM_SERVER_KEY not configured, push notification not sent");
        return false;
      }

      const payload = JSON.stringify({
        notification: {
          title: "AnchorPoint Notification",
          body: message,
        },
        to,
      });

      const options = {
        hostname: "fcm.googleapis.com",
        port: 443,
        path: "/fcm/send",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `key=${fcmServerKey}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      };

      return new Promise((resolve) => {
        const req = https.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (res.statusCode === 200) {
              logger.info(`FCM push notification sent successfully to ${to}`);
              resolve(true);
            } else {
              logger.error(`FCM push notification failed: ${res.statusCode} ${data}`);
              resolve(false);
            }
          });
        });

        req.on("error", (error) => {
          logger.error("FCM push notification error:", error);
          resolve(false);
        });

        req.write(payload);
        req.end();
      });
    } catch (error) {
      logger.error("Error sending FCM push notification:", error);
      return false;
    }
  }
}

/** Email: SendGrid if configured, else SMTP, else console logging. */
export function createEmailProvider(): NotificationProvider {
  if (SendGridEmailProvider.isConfigured()) return new SendGridEmailProvider();
  return smtpService.isConfigured()
    ? new SmtpEmailProvider()
    : new ConsoleEmailProvider();
}

/** SMS: Twilio if configured, else console logging. */
export function createSmsProvider(): NotificationProvider {
  return TwilioSmsProvider.isConfigured()
    ? new TwilioSmsProvider()
    : new ConsoleSmsProvider();
}

/** Push: FCM if FCM_SERVER_KEY is set, else console logging. */
export function createPushProvider(): NotificationProvider {
  return process.env.FCM_SERVER_KEY
    ? new FcmPushProvider()
    : new ConsolePushProvider();
}

const providerFactories: Record<NotificationType, () => NotificationProvider> = {
  [NotificationType.EMAIL]: createEmailProvider,
  [NotificationType.SMS]: createSmsProvider,
  [NotificationType.PUSH]: createPushProvider,
};

/**
 * Unified dispatcher: sends `message` to `recipient` over `channel` using the
 * provider selected from the current environment configuration.
 */
export async function sendNotification(
  channel: NotificationType,
  recipient: string,
  message: string,
): Promise<boolean> {
  const factory = providerFactories[channel];
  if (!factory) {
    logger.warn(`Unsupported notification channel: ${channel}`);
    return false;
  }
  return factory().send(recipient, message);
}
