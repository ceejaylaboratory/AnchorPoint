import { Router } from 'express';
import { getInfo } from '../controllers/info.controller';

const router = Router();

/**
 * @swagger
 * /info:
 *   get:
 *     summary: SEP-1 Info Endpoint
 *     description: Returns stellar.toml information in JSON or TOML format. Supports both JSON and TOML responses based on Accept header or format query parameter.
 *     tags: [SEP-1 Info]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, toml]
 *         description: Response format preference (json or toml)
 *     responses:
 *       200:
 *         description: Anchor information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: SEP-1 anchor info in JSON format
 *           text/plain:
 *             schema:
 *               type: string
 *               description: SEP-1 anchor info in TOML format
 */
router.get('/', getInfo);

export default router;
