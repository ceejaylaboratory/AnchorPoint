/**
 * Relayer Routes
 * 
 * API routes for signature-based gasless token approvals
 */

import { Router } from 'express';
import {
  submitApproval,
  verifySignature,
  submitSignedTransaction,
  generateNonce,
  getRelayerConfig,
} from '../controllers/relayer.controller';

const router = Router();

/**
 * @swagger
 * /api/relayer/approve:
 *   post:
 *     summary: Submit a token approval request with signature
 *     description: The relayer verifies the signature and submits the transaction on behalf of the user
 *     tags: [Relayer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userPublicKey
 *               - spenderPublicKey
 *               - amount
 *               - nonce
 *               - expiry
 *               - signature
 *             properties:
 *               userPublicKey:
 *                 type: string
 *                 description: The user's public key
 *               spenderPublicKey:
 *                 type: string
 *                 description: The spender's public key (address being approved)
 *               amount:
 *                 type: string
 *                 description: The approval amount
 *               assetCode:
 *                 type: string
 *                 description: Asset code (optional, defaults to XLM)
 *               assetIssuer:
 *                 type: string
 *                 description: Asset issuer (optional, for custom assets)
 *               nonce:
 *                 type: string
 *                 description: Unique nonce to prevent replay attacks
 *               expiry:
 *                 type: number
 *                 description: Unix timestamp when the request expires
 *               signature:
 *                 type: string
 *                 description: Base64 encoded signature of the approval message
 *     responses:
 *       200:
 *         description: Approval submitted successfully
 *       400:
 *         description: Invalid request or signature verification failed
 *       500:
 *         description: Internal server error
 */
router.post('/approve', submitApproval);

/**
 * @swagger
 * /api/relayer/verify:
 *   post:
 *     summary: Verify a signature without submitting
 *     description: Pre-verification of signature before submission
 *     tags: [Relayer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userPublicKey
 *               - signature
 *             properties:
 *               userPublicKey:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Signature verification result
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Internal server error
 */
router.post('/verify', verifySignature);

/**
 * @swagger
 * /api/relayer/submit:
 *   post:
 *     summary: Submit a pre-signed transaction
 *     description: Submit a transaction that's already signed by the user
 *     tags: [Relayer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signedTransactionXdr
 *               - networkPassphrase
 *             properties:
 *               signedTransactionXdr:
 *                 type: string
 *                 description: Base64 encoded signed transaction XDR
 *               networkPassphrase:
 *                 type: string
 *                 description: Network passphrase (e.g., Test SDF Network)
 *     responses:
 *       200:
 *         description: Transaction submitted successfully
 *       400:
 *         description: Invalid request or transaction failed
 *       500:
 *         description: Internal server error
 */
router.post('/submit', submitSignedTransaction);

/**
 * @swagger
 * /api/relayer/nonce:
 *   get:
 *     summary: Generate a nonce for approval requests
 *     description: Returns a unique nonce to prevent replay attacks
 *     tags: [Relayer]
 *     responses:
 *       200:
 *         description: Nonce generated successfully
 *       500:
 *         description: Internal server error
 */
router.get('/nonce', generateNonce);

/**
 * @swagger
 * /api/relayer/config:
 *   get:
 *     summary: Get relayer configuration
 *     description: Returns public relayer configuration (excludes sensitive data)
 *     tags: [Relayer]
 *     responses:
 *       200:
 *         description: Relayer configuration
 *       500:
 *         description: Internal server error
 */
router.get('/config', getRelayerConfig);

export default router;
