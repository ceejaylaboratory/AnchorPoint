import { Router } from 'express';
import { getInfo } from '../controllers/info.controller';

const router = Router();

/**
 * GET /info
 * SEP-1 Info Endpoint
 * Returns stellar.toml information in JSON or TOML format
 * Supports both JSON and TOML responses based on Accept header or format query parameter
 */
router.get('/', getInfo);

export default router;
