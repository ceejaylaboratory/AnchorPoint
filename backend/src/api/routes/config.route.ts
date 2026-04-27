import { Router } from 'express';
import { getConfig, getHistory, updateConfig, rollbackConfig } from '../controllers/config.controller';
import { auditLog } from '../middleware/audit-log.middleware';
import configService from '../../services/config.service';

const router = Router();

/**
 * @swagger
 * /config:
 *   get:
 *     summary: Get active configuration
 *     description: Retrieves the current active dynamic configuration for the backend. Requires an API key with appropriate permissions (usually admin tier, but for now uses general API Key auth).
 *     tags: [Configuration]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Active configuration retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/', getConfig);

/**
 * @swagger
 * /config/history:
 *   get:
 *     summary: Get configuration history
 *     description: Retrieves past configuration versions (up to 20).
 *     tags: [Configuration]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Configuration history retrieved
 *       401:
 *         description: Unauthorized
 */
router.get('/history', getHistory);

/**
 * @swagger
 * /config:
 *   post:
 *     summary: Update configuration
 *     description: Updates the dynamic configuration, bumping the version and broadcasting the change to other instances.
 *     tags: [Configuration]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: The new configuration settings (must pass validation)
 *     responses:
 *       200:
 *         description: Configuration updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/', auditLog({
  action: 'CONFIG_UPDATE',
  resourceType: 'config',
  getBefore: () => configService.getConfig(),
}), updateConfig);

/**
 * @swagger
 * /config/rollback/{version}:
 *   post:
 *     summary: Rollback configuration
 *     description: Reverts the configuration to a specific previous version.
 *     tags: [Configuration]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: version
 *         schema:
 *           type: integer
 *         required: true
 *         description: The version number to rollback to
 *     responses:
 *       200:
 *         description: Rolled back successfully
 *       400:
 *         description: Invalid version number
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Version not found
 */
router.post('/rollback/:version', auditLog({
  action: 'CONFIG_ROLLBACK',
  resourceType: 'config',
  getResourceId: (req) => req.params.version,
  getBefore: () => configService.getConfig(),
}), rollbackConfig);

export default router;
