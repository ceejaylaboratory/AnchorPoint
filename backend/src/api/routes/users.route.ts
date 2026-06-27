import { Router, Response } from 'express';
import prisma from '../../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

/**
 * @swagger
 * /api/users/hierarchy:
 *   get:
 *     summary: Get User Referral Hierarchy
 *     description: Fetches the downline referral hierarchy for the authenticated user using a recursive CTE.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Hierarchy retrieved successfully
 */
router.get('/hierarchy', authMiddleware, async (req: AuthRequest, res: Response) => {
  const publicKey = req.user!.publicKey;

  try {
    const user = await prisma.user.findUnique({ where: { publicKey } });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const userId = user.id;

    // We use a raw query here to demonstrate Recursive CTE capabilities,
    // which Prisma doesn't natively support in its high-level API.
    const hierarchy = await prisma.$queryRaw`
      WITH RECURSIVE
        UserHierarchy(id, publicKey, email, parentUserId, level) AS (
          -- Anchor member
          SELECT id, publicKey, email, parentUserId, 0
          FROM User
          WHERE id = ${userId}
          
          UNION ALL
          
          -- Recursive member
          SELECT u.id, u.publicKey, u.email, u.parentUserId, uh.level + 1
          FROM User u
          JOIN UserHierarchy uh ON u.parentUserId = uh.id
        )
      SELECT * FROM UserHierarchy;
    `;

    res.json({
      status: 'success',
      data: hierarchy,
    });
  } catch (error) {
    console.error('Error fetching user hierarchy:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch user hierarchy',
    });
  }
});

export default router;
