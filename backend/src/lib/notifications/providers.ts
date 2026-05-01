import { NotificationProvider } from "../../services/notification.service";
import logger from "../../utils/logger";

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
