import { NotificationType, NotificationStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import logger from "../utils/logger";

export interface NotificationProvider {
  send(to: string, message: string): Promise<boolean>;
}

export class NotificationService {
  private static instance: NotificationService;
  private providers: Map<NotificationType, NotificationProvider> = new Map();

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  public registerProvider(type: NotificationType, provider: NotificationProvider) {
    this.providers.set(type, provider);
  }

  /**
   * Main entry point to send notifications based on user preferences
   */
  async notify(userId: string, message: string, transactionId?: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { notificationPreference: true },
      });

      if (!user) {
        logger.error("User not found for notification", { userId });
        return;
      }

      // Default to email only if no preferences set
      const prefs = user.notificationPreference || {
        emailEnabled: true,
        smsEnabled: false,
        pushEnabled: false,
      };

      const types: NotificationType[] = [];
      if (prefs.emailEnabled && user.email) types.push(NotificationType.EMAIL);
      if (prefs.smsEnabled && user.phone) types.push(NotificationType.SMS);
      if (prefs.pushEnabled) types.push(NotificationType.PUSH);

      if (types.length === 0) {
        logger.info("No notification channels enabled for user", { userId });
        return;
      }

      // Fan out notifications across enabled channels
      await Promise.all(
        types.map((type) =>
          this.sendThroughProvider(userId, type, user, message, transactionId),
        ),
      );
    } catch (error) {
      logger.error("Failed to process notifications", { userId, error });
    }
  }

  private async sendThroughProvider(
    userId: string,
    type: NotificationType,
    user: any,
    message: string,
    transactionId?: string,
  ): Promise<void> {
    const provider = this.providers.get(type);
    if (!provider) {
      logger.warn(`No provider registered for notification type: ${type}`);
      return;
    }

    // 1. Create a pending notification record
    const notification = await prisma.notification.create({
      data: {
        userId,
        transactionId: transactionId || null,
        type,
        status: NotificationStatus.PENDING,
        message,
      },
    });

    // 2. Resolve destination
    let to: string | null = null;
    if (type === NotificationType.EMAIL) to = user.email;
    else if (type === NotificationType.SMS) to = user.phone;
    else if (type === NotificationType.PUSH) to = "push_token_placeholder"; // In real app, fetch from UserDevice model

    if (!to) {
      logger.warn(`No destination found for ${type} notification`, { userId });
      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.FAILED },
      });
      return;
    }

    // 3. Attempt delivery
    try {
      const success = await provider.send(to, message);
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: success ? NotificationStatus.SENT : NotificationStatus.FAILED,
        },
      });
    } catch (error) {
      logger.error(`Error in ${type} provider delivery`, { userId, error });
      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.FAILED },
      });
    }
  }
}

export const notificationService = NotificationService.getInstance();
