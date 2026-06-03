import { NotificationProvider } from "../../services/notification.service";
import { smtpService } from "../smtp.service";
import logger from "../../utils/logger";

export class SmtpEmailProvider implements NotificationProvider {
  async send(to: string, message: string): Promise<boolean> {
    return smtpService.sendMail({
      to,
      subject: "AnchorPoint Notification",
      text: message,
    });
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

export class ConsolePushProvider implements NotificationProvider {
  async send(to: string, message: string): Promise<boolean> {
    logger.info(`[MOCK PUSH] To: ${to} | Message: ${message}`);
    return true;
  }
}

export function createEmailProvider(): NotificationProvider {
  return smtpService.isConfigured()
    ? new SmtpEmailProvider()
    : new ConsoleEmailProvider();
}
