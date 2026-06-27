import { Router, Request, Response } from 'express';
import { FeatureFlagService } from '../../services/feature-flag.service';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { z } from 'zod';
import logger from '../../utils/logger';

export function createFeatureFlagRouter(featureFlagService: FeatureFlagService): Router {
  const router = Router();

  // Validation schemas
  const createFlagSchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    enabled: z.boolean().default(true),
    rolloutPercentage: z.number().min(0).max(100).default(100),
    targetUsers: z.array(z.string()).optional(),
  });

  const updateFlagSchema = z.object({
    enabled: z.boolean().optional(),
    rolloutPercentage: z.number().min(0).max(100).optional(),
    targetUsers: z.array(z.string()).optional(),
  });

  // GET /feature-flags - List all flags
  router.get(
    '/',
    async (req: Request, res: Response) => {
      try {
        const flags = await featureFlagService.getAllFlags();
        res.json({
          success: true,
          data: flags,
          count: flags.length,
        });
      } catch (error) {
        logger.error('Error fetching feature flags:', error);
        res.status(500).json({
          error: 'Failed to fetch feature flags',
          statusCode: 500,
        });
      }
    }
  );

  // GET /feature-flags/:flagName - Get specific flag
  router.get(
    '/:flagName',
    async (req: Request, res: Response) => {
      try {
        const { flagName } = req.params;
        const flag = await featureFlagService.getFlag(flagName);

        if (!flag) {
          return res.status(404).json({
            error: 'Feature flag not found',
            statusCode: 404,
          });
        }

        res.json({
          success: true,
          data: flag,
        });
      } catch (error) {
        logger.error('Error fetching feature flag:', error);
        res.status(500).json({
          error: 'Failed to fetch feature flag',
          statusCode: 500,
        });
      }
    }
  );

  // POST /feature-flags - Create new flag (admin only)
  router.post(
    '/',
    authMiddleware,
    validate({ body: createFlagSchema }),
    async (req: Request, res: Response) => {
      try {
        const { name, description, enabled, rolloutPercentage, targetUsers } = req.body;

        // Check if flag already exists
        const existing = await featureFlagService.getFlag(name);
        if (existing) {
          return res.status(409).json({
            error: 'Feature flag already exists',
            statusCode: 409,
          });
        }

        const newFlag = {
          name,
          description,
          enabled,
          rolloutPercentage,
          targetUsers: targetUsers || [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await featureFlagService.setFlag(name, newFlag);

        res.status(201).json({
          success: true,
          message: 'Feature flag created',
          data: newFlag,
        });
      } catch (error) {
        logger.error('Error creating feature flag:', error);
        res.status(500).json({
          error: 'Failed to create feature flag',
          statusCode: 500,
        });
      }
    }
  );

  // PATCH /feature-flags/:flagName - Update flag (admin only)
  router.patch(
    '/:flagName',
    authMiddleware,
    validate({ body: updateFlagSchema }),
    async (req: Request, res: Response) => {
      try {
        const { flagName } = req.params;
        const updates = req.body;

        const flag = await featureFlagService.getFlag(flagName);
        if (!flag) {
          return res.status(404).json({
            error: 'Feature flag not found',
            statusCode: 404,
          });
        }

        // Update flag properties
        if (updates.enabled !== undefined) {
          flag.enabled = updates.enabled;
        }
        if (updates.rolloutPercentage !== undefined) {
          flag.rolloutPercentage = updates.rolloutPercentage;
        }
        if (updates.targetUsers !== undefined) {
          flag.targetUsers = updates.targetUsers;
        }

        await featureFlagService.setFlag(flagName, flag);

        res.json({
          success: true,
          message: 'Feature flag updated',
          data: flag,
        });
      } catch (error) {
        logger.error('Error updating feature flag:', error);
        res.status(500).json({
          error: 'Failed to update feature flag',
          statusCode: 500,
        });
      }
    }
  );

  // PUT /feature-flags/:flagName/enable - Enable flag
  router.put(
    '/:flagName/enable',
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { flagName } = req.params;

        const flag = await featureFlagService.getFlag(flagName);
        if (!flag) {
          return res.status(404).json({
            error: 'Feature flag not found',
            statusCode: 404,
          });
        }

        await featureFlagService.enableFlag(flagName);

        res.json({
          success: true,
          message: `Feature flag '${flagName}' enabled`,
        });
      } catch (error) {
        logger.error('Error enabling feature flag:', error);
        res.status(500).json({
          error: 'Failed to enable feature flag',
          statusCode: 500,
        });
      }
    }
  );

  // PUT /feature-flags/:flagName/disable - Disable flag
  router.put(
    '/:flagName/disable',
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { flagName } = req.params;

        const flag = await featureFlagService.getFlag(flagName);
        if (!flag) {
          return res.status(404).json({
            error: 'Feature flag not found',
            statusCode: 404,
          });
        }

        await featureFlagService.disableFlag(flagName);

        res.json({
          success: true,
          message: `Feature flag '${flagName}' disabled`,
        });
      } catch (error) {
        logger.error('Error disabling feature flag:', error);
        res.status(500).json({
          error: 'Failed to disable feature flag',
          statusCode: 500,
        });
      }
    }
  );

  // PUT /feature-flags/:flagName/rollout - Update rollout percentage
  router.put(
    '/:flagName/rollout',
    authMiddleware,
    validate({
      body: z.object({
        percentage: z.number().min(0).max(100),
      }),
    }),
    async (req: Request, res: Response) => {
      try {
        const { flagName } = req.params;
        const { percentage } = req.body;

        const flag = await featureFlagService.getFlag(flagName);
        if (!flag) {
          return res.status(404).json({
            error: 'Feature flag not found',
            statusCode: 404,
          });
        }

        await featureFlagService.updateRolloutPercentage(flagName, percentage);

        res.json({
          success: true,
          message: `Rollout percentage for '${flagName}' updated to ${percentage}%`,
          data: { flagName, percentage },
        });
      } catch (error) {
        logger.error('Error updating rollout percentage:', error);
        res.status(500).json({
          error: 'Failed to update rollout percentage',
          statusCode: 500,
        });
      }
    }
  );

  // POST /feature-flags/:flagName/target-users - Add target users
  router.post(
    '/:flagName/target-users',
    authMiddleware,
    validate({
      body: z.object({
        userIds: z.array(z.string()).min(1),
      }),
    }),
    async (req: Request, res: Response) => {
      try {
        const { flagName } = req.params;
        const { userIds } = req.body;

        const flag = await featureFlagService.getFlag(flagName);
        if (!flag) {
          return res.status(404).json({
            error: 'Feature flag not found',
            statusCode: 404,
          });
        }

        await featureFlagService.addTargetUsers(flagName, userIds);

        res.json({
          success: true,
          message: `Target users added to '${flagName}'`,
          data: { flagName, addedUsers: userIds },
        });
      } catch (error) {
        logger.error('Error adding target users:', error);
        res.status(500).json({
          error: 'Failed to add target users',
          statusCode: 500,
        });
      }
    }
  );

  // DELETE /feature-flags/:flagName/target-users - Remove target users
  router.delete(
    '/:flagName/target-users',
    authMiddleware,
    validate({
      body: z.object({
        userIds: z.array(z.string()).min(1),
      }),
    }),
    async (req: Request, res: Response) => {
      try {
        const { flagName } = req.params;
        const { userIds } = req.body;

        const flag = await featureFlagService.getFlag(flagName);
        if (!flag) {
          return res.status(404).json({
            error: 'Feature flag not found',
            statusCode: 404,
          });
        }

        await featureFlagService.removeTargetUsers(flagName, userIds);

        res.json({
          success: true,
          message: `Target users removed from '${flagName}'`,
          data: { flagName, removedUsers: userIds },
        });
      } catch (error) {
        logger.error('Error removing target users:', error);
        res.status(500).json({
          error: 'Failed to remove target users',
          statusCode: 500,
        });
      }
    }
  );

  // DELETE /feature-flags/:flagName - Delete flag
  router.delete(
    '/:flagName',
    authMiddleware,
    async (req: Request, res: Response) => {
      try {
        const { flagName } = req.params;

        const flag = await featureFlagService.getFlag(flagName);
        if (!flag) {
          return res.status(404).json({
            error: 'Feature flag not found',
            statusCode: 404,
          });
        }

        await featureFlagService.deleteFlag(flagName);

        res.json({
          success: true,
          message: `Feature flag '${flagName}' deleted`,
        });
      } catch (error) {
        logger.error('Error deleting feature flag:', error);
        res.status(500).json({
          error: 'Failed to delete feature flag',
          statusCode: 500,
        });
      }
    }
  );

  return router;
}
