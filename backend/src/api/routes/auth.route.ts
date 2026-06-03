import { Router, Request, Response } from 'express';
import { RedisService } from '../../services/redis.service';
import { getChallenge, getToken } from '../controllers/auth.controller';

const router = Router();

// Mock Redis client for demonstration
// In a real implementation, you would inject the actual Redis client
const mockRedisClient = {
  get: async () => null,
  set: async () => {},
  del: async () => 1,
  expire: async () => {}
};

const redisService = new RedisService(mockRedisClient);

/**
 * @swagger
 * /auth:
 *   post:
 *     summary: SEP-10 Challenge Endpoint
 *     description: Generates a SEP-10 challenge transaction for client authentication with multi-key support
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - account
 *             properties:
 *               account:
 *                 type: string
 *                 description: Stellar account public key
 *                 example: GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 *               multiKey:
 *                 type: boolean
 *                 description: Enable multi-key authentication
 *                 default: false
 *               signers:
 *                 type: array
 *                 description: List of signers for multi-key authentication
 *                 items:
 *                   type: object
 *                   properties:
 *                     publicKey:
 *                       type: string
 *                       description: Signer public key
 *                     weight:
 *                       type: number
 *                       description: Signer weight
 *                     signed:
 *                       type: boolean
 *                       description: Whether signer has signed
 *               threshold:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 description: Authentication threshold level
 *                 default: medium
 *               home_domain:
 *                 type: string
 *                 description: Home domain for the challenge
 *               client_domain:
 *                 type: string
 *                 description: Client domain
 *     responses:
 *       200:
 *         description: Challenge transaction generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction:
 *                   type: string
 *                   description: Base64 encoded challenge transaction
 *                 network_passphrase:
 *                   type: string
 *                   description: Stellar network passphrase
 *                 multiKeyChallenge:
 *                   type: object
 *                   description: Multi-key challenge requirements
 *                   properties:
 *                     requiredSigners:
 *                       type: number
 *                       description: Number of signers required
 *                     threshold:
 *                       type: string
 *                       description: Authentication threshold
 *                     signers:
 *                       type: array
 *                       description: Signer information
 *       400:
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', async (req: Request, res: Response) => {
  return getChallenge(req, res, redisService);
});

/**
 * @swagger
 * /auth/token:
 *   post:
 *     summary: SEP-10 Token Endpoint
 *     description: Validates a signed challenge transaction and returns a JWT token with multi-key support
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transaction
 *             properties:
 *               transaction:
 *                 type: string
 *                 description: Signed SEP-10 challenge transaction XDR
 *               signatures:
 *                 type: array
 *                 description: Multi-key signatures for authentication
 *                 items:
 *                   type: object
 *                   properties:
 *                     publicKey:
 *                       type: string
 *                       description: Signer public key
 *                     signature:
 *                       type: string
 *                       description: Signature data
 *                     weight:
 *                       type: number
 *                       description: Signer weight
 *               threshold:
 *                 type: string
 *                 enum: [low, medium, high]
 *                 description: Authentication threshold level
 *                 default: medium
 *               client_signature:
 *                 type: string
 *                 description: Client signature (for single-key auth)
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: JWT authentication token
 *                 type:
 *                   type: string
 *                   description: Token type
 *                   enum: [bearer]
 *                 expires_in:
 *                   type: number
 *                   description: Token expiration time in seconds
 *                 authLevel:
 *                   type: string
 *                   description: Authentication level achieved
 *                   enum: [partial, medium, full]
 *                 signers:
 *                   type: array
 *                   description: List of signer public keys
 *                   items:
 *                     type: string
 *       400:
 *         description: Invalid or expired challenge
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid signature
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/token', async (req: Request, res: Response) => {
  return getToken(req, res, redisService);
});

export default router;
