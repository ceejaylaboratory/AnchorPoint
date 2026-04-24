import { Router } from 'express';
import { getInfo } from '../controllers/info.controller';

const router = Router();

/**
 * @swagger
 * /info:
 *   get:
 *     summary: SEP-1 Info Endpoint
 *     description: Returns stellar.toml information in JSON or TOML format. Supports both JSON and TOML responses based on Accept header or format query parameter.
 *     tags: [Info]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, toml]
 *         description: Response format preference (json or toml)
 *       - in: header
 *         name: Accept
 *         schema:
 *           type: string
 *         description: Accept header for content negotiation
 *     responses:
 *       200:
 *         description: Anchor information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Sep1Info'
 *           text/toml:
 *             schema:
 *               type: string
 *               description: TOML formatted stellar.toml content
 */
router.get('/', getInfo);

export default router;
