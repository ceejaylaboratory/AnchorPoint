import { Router, Response } from "express";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";

const router = Router();

const preferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  phone: z.string().optional(),
});

/**
 * @swagger
 * /api/notifications/preferences:
 *   get:
 *     summary: Get notification preferences
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/preferences",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    const publicKey = req.user!.publicKey;

    try {
      const user = await prisma.user.findUnique({
        where: { publicKey },
        include: { notificationPreference: true },
      });

      if (!user) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }

      res.json({
        status: "success",
        data: {
          emailEnabled: user.notificationPreference?.emailEnabled ?? true,
          smsEnabled: user.notificationPreference?.smsEnabled ?? false,
          pushEnabled: user.notificationPreference?.pushEnabled ?? false,
          phone: user.phone,
        },
      });
    } catch (error) {
      res
        .status(500)
        .json({ status: "error", message: "Failed to fetch preferences" });
    }
  },
);

/**
 * @swagger
 * /api/notifications/preferences:
 *   patch:
 *     summary: Update notification preferences
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
  "/preferences",
  authMiddleware,
  validate({ body: preferencesSchema }),
  async (req: AuthRequest, res: Response) => {
    const publicKey = req.user!.publicKey;
    const { emailEnabled, smsEnabled, pushEnabled, phone } = req.body;

    try {
      const user = await prisma.user.findUnique({ where: { publicKey } });
      if (!user) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }

      await prisma.$transaction([
        prisma.notificationPreference.upsert({
          where: { userId: user.id },
          update: { emailEnabled, smsEnabled, pushEnabled },
          create: {
            userId: user.id,
            emailEnabled: emailEnabled ?? true,
            smsEnabled: smsEnabled ?? false,
            pushEnabled: pushEnabled ?? false,
          },
        }),
        ...(phone
          ? [prisma.user.update({ where: { id: user.id }, data: { phone } })]
          : []),
      ]);

      res.json({ status: "success", message: "Preferences updated" });
    } catch (error) {
      res
        .status(500)
        .json({ status: "error", message: "Failed to update preferences" });
    }
  },
);

/**
 * @swagger
 * /api/notifications/history:
 *   get:
 *     summary: Get notification history
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  "/history",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    const publicKey = req.user!.publicKey;

    try {
      const user = await prisma.user.findUnique({ where: { publicKey } });
      if (!user) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }

      const notifications = await prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      res.json({ status: "success", data: notifications });
    } catch (error) {
      res
        .status(500)
        .json({ status: "error", message: "Failed to fetch history" });
    }
  },
);

export default router;
