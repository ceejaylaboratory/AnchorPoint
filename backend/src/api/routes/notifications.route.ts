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

const markReadSchema = z.object({
  notificationIds: z.array(z.string().min(1)).min(1),
});

/**
 * @swagger
 * /api/notifications/preferences:
 *   get:
 *     summary: Get notification preferences
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notification preferences
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: object
 *                   properties:
 *                     emailEnabled:
 *                       type: boolean
 *                     smsEnabled:
 *                       type: boolean
 *                     pushEnabled:
 *                       type: boolean
 *                     phone:
 *                       type: string
 *       401:
 *         description: Missing or invalid JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to fetch preferences
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               emailEnabled:
 *                 type: boolean
 *               smsEnabled:
 *                 type: boolean
 *               pushEnabled:
 *                 type: boolean
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Preferences updated
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Missing or invalid JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to update preferences
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 *     description: Returns the 50 most recent notifications for the authenticated user.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notification history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Missing or invalid JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to fetch history
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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

/**
 * @swagger
 * /api/notifications/history:
 *   patch:
 *     summary: Mark notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [notificationIds]
 *             properties:
 *               notificationIds:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Notifications marked as read
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Missing or invalid JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to mark notifications as read
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.patch(
  "/history",
  authMiddleware,
  validate({ body: markReadSchema }),
  async (req: AuthRequest, res: Response) => {
    const publicKey = req.user!.publicKey;
    const { notificationIds } = req.body;

    try {
      const user = await prisma.user.findUnique({ where: { publicKey } });
      if (!user) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }

      await prisma.notification.updateMany({
        where: {
          userId: user.id,
          id: { in: notificationIds },
        },
        data: { status: "SENT" },
      });

      res.json({ status: "success", message: "Notifications marked as read" });
    } catch (error) {
      res
        .status(500)
        .json({ status: "error", message: "Failed to mark notifications as read" });
    }
  },
);

export default router;
