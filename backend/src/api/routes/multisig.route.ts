import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import multisigController from '../controllers/multisig.controller';

const router = Router();

// Validation schemas
const createTransactionSchema = z.object({
  envelopeXdr: z.string().min(1, 'Transaction envelope XDR is required'),
  requiredSigners: z.array(z.string()).min(1, 'At least one required signer must be specified'),
  threshold: z.number().int().min(1, 'Threshold must be at least 1'),
  memo: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const addSignatureSchema = z.object({
  signedEnvelopeXdr: z.string().min(1, 'Signed envelope XDR is required'),
});

const markNotificationsSchema = z.object({
  notificationIds: z.array(z.string()).min(1, 'At least one notification ID is required'),
});

const queryStatusSchema = z.object({
  status: z.enum(['PENDING', 'PARTIALLY_SIGNED', 'READY', 'SUBMITTED', 'FAILED', 'EXPIRED']).optional(),
});

const queryUnreadSchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
});

const createAdminProposalSchema = z.object({
  actionType: z.string().min(1, 'actionType is required'),
  description: z.string().min(1, 'description is required'),
  payload: z.record(z.string(), z.any()),
  requiredSigners: z.array(z.string()).min(2, 'At least two required signers are required'),
  threshold: z.number().int().min(2, 'Threshold must be at least 2').optional(),
});

const approveAdminProposalSchema = z.object({
  signature: z.string().min(1, 'Cryptographic signature is required'),
  signerPublicKey: z.string().optional(),
});

const rejectAdminProposalSchema = z.object({
  reason: z.string().optional(),
  signerPublicKey: z.string().optional(),
});

const queryProposalStatusSchema = z.object({
  status: z.enum(['PROPOSED', 'APPROVED', 'EXECUTED', 'REJECTED']).optional(),
});


/**
 * @swagger
 * components:
 *   schemas:
 *     MultisigTransaction:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         hash:
 *           type: string
 *         envelopeXdr:
 *           type: string
 *         creatorPublicKey:
 *           type: string
 *         requiredSigners:
 *           type: array
 *           items:
 *             type: string
 *         threshold:
 *           type: integer
 *         currentSignatures:
 *           type: integer
 *         status:
 *           type: string
 *           enum: [PENDING, PARTIALLY_SIGNED, READY, SUBMITTED, FAILED, EXPIRED]
 *         signatures:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               signerPublicKey:
 *                 type: string
 *               signedAt:
 *                 type: string
 *                 format: date-time
 *         memo:
 *           type: string
 *         expiresAt:
 *           type: string
 *           format: date-time
 *         submittedAt:
 *           type: string
 *           format: date-time
 *         stellarTxId:
 *           type: string
 *         metadata:
 *           type: object
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/multisig/transactions:
 *   post:
 *     summary: Create a new multisig transaction
 *     description: Creates a new multisig transaction that requires signatures from multiple parties
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - envelopeXdr
 *               - requiredSigners
 *               - threshold
 *             properties:
 *               envelopeXdr:
 *                 type: string
 *                 description: Base64 encoded transaction envelope
 *               requiredSigners:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of public keys that must sign
 *               threshold:
 *                 type: integer
 *                 minimum: 1
 *                 description: Number of signatures required
 *               memo:
 *                 type: string
 *                 description: Optional memo for the transaction
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 description: Optional expiration date
 *               metadata:
 *                 type: object
 *                 description: Optional additional metadata
 *     responses:
 *       201:
 *         description: Transaction created successfully
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
 *                     transaction:
 *                       $ref: '#/components/schemas/MultisigTransaction'
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/transactions',
  authMiddleware,
  validate({ body: createTransactionSchema }),
  multisigController.createTransaction.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/transactions/{transactionId}/sign:
 *   post:
 *     summary: Add a signature to a multisig transaction
 *     description: Adds the authenticated user's signature to a pending multisig transaction
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The multisig transaction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signedEnvelopeXdr
 *             properties:
 *               signedEnvelopeXdr:
 *                 type: string
 *                 description: Base64 encoded signed transaction envelope
 *     responses:
 *       200:
 *         description: Signature added successfully
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
 *                     transaction:
 *                       $ref: '#/components/schemas/MultisigTransaction'
 *       400:
 *         description: Invalid request or signature
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transaction not found
 */
router.post(
  '/transactions/:transactionId/sign',
  authMiddleware,
  validate({ body: addSignatureSchema }),
  multisigController.addSignature.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/transactions/{transactionId}:
 *   get:
 *     summary: Get a multisig transaction by ID
 *     description: Retrieves details of a specific multisig transaction
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The multisig transaction ID
 *     responses:
 *       200:
 *         description: Transaction retrieved successfully
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
 *                     transaction:
 *                       $ref: '#/components/schemas/MultisigTransaction'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transaction not found
 */
router.get(
  '/transactions/:transactionId',
  authMiddleware,
  multisigController.getTransaction.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/transactions:
 *   get:
 *     summary: Get multisig transactions for the authenticated user
 *     description: Retrieves all multisig transactions where the user is a required signer
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PARTIALLY_SIGNED, READY, SUBMITTED, FAILED, EXPIRED]
 *         description: Filter by transaction status
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully
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
 *                     transactions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/MultisigTransaction'
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/transactions',
  authMiddleware,
  validate({ query: queryStatusSchema }),
  multisigController.getMyTransactions.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/pending:
 *   get:
 *     summary: Get pending transactions requiring signature
 *     description: Retrieves all pending multisig transactions that need the user's signature
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending transactions retrieved successfully
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
 *                     transactions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/MultisigTransaction'
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/pending',
  authMiddleware,
  multisigController.getPendingTransactions.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/transactions/{transactionId}/submit:
 *   post:
 *     summary: Manually submit a transaction
 *     description: Manually submits a transaction that has reached the signature threshold
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The multisig transaction ID
 *     responses:
 *       200:
 *         description: Transaction submitted successfully
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
 *                     transaction:
 *                       $ref: '#/components/schemas/MultisigTransaction'
 *       400:
 *         description: Invalid request or transaction not ready
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Transaction not found
 */
router.post(
  '/transactions/:transactionId/submit',
  authMiddleware,
  multisigController.submitTransaction.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/notifications:
 *   get:
 *     summary: Get notifications for the authenticated user
 *     description: Retrieves all notifications related to multisig transactions
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Filter to show only unread notifications
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
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
 *                     notifications:
 *                       type: array
 *                       items:
 *                         type: object
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/notifications',
  authMiddleware,
  validate({ query: queryUnreadSchema }),
  multisigController.getNotifications.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/notifications/read:
 *   post:
 *     summary: Mark notifications as read
 *     description: Marks specified notifications as read
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - notificationIds
 *             properties:
 *               notificationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/notifications/read',
  authMiddleware,
  validate({ body: markNotificationsSchema }),
  multisigController.markNotificationsAsRead.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/proposals:
 *   post:
 *     summary: Propose an administrative action requiring multi-signature approval
 *     description: Creates a new administrative action proposal requiring co-signer cryptographic approval
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - actionType
 *               - description
 *               - payload
 *               - requiredSigners
 *             properties:
 *               actionType:
 *                 type: string
 *                 example: CONFIG_UPDATE
 *               description:
 *                 type: string
 *                 example: Update surge multiplier threshold
 *               payload:
 *                 type: object
 *                 example: { "RELAYER_FEE_SURGE_MULTIPLIER": 1.5 }
 *               requiredSigners:
 *                 type: array
 *                 items:
 *                   type: string
 *               threshold:
 *                 type: integer
 *                 minimum: 2
 *                 default: 2
 *     responses:
 *       201:
 *         description: Proposal created successfully
 *       400:
 *         description: Invalid proposal payload
 */
router.post(
  '/proposals',
  authMiddleware,
  validate({ body: createAdminProposalSchema }),
  multisigController.createAdminProposal.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/proposals:
 *   get:
 *     summary: List administrative action proposals
 *     description: Returns administrative proposals optionally filtered by status (PROPOSED, APPROVED, EXECUTED, REJECTED)
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PROPOSED, APPROVED, EXECUTED, REJECTED]
 *     responses:
 *       200:
 *         description: Proposals list
 */
router.get(
  '/proposals',
  authMiddleware,
  validate({ query: queryProposalStatusSchema }),
  multisigController.getAdminProposals.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/proposals/{proposalId}:
 *   get:
 *     summary: Get administrative action proposal by ID
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Proposal details
 *       404:
 *         description: Proposal not found
 */
router.get(
  '/proposals/:proposalId',
  authMiddleware,
  multisigController.getAdminProposalById.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/proposals/{proposalId}/approve:
 *   post:
 *     summary: Approve an administrative action proposal with cryptographic signature
 *     description: Submits co-signer signature over the proposal canonical digest
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signature
 *             properties:
 *               signature:
 *                 type: string
 *                 description: Base64 cryptographic Ed25519 signature
 *               signerPublicKey:
 *                 type: string
 *                 description: Signer public key (optional if in JWT auth)
 *     responses:
 *       200:
 *         description: Proposal approved / signature recorded
 *       400:
 *         description: Invalid signature or unauthorized signer
 */
router.post(
  '/proposals/:proposalId/approve',
  authMiddleware,
  validate({ body: approveAdminProposalSchema }),
  multisigController.approveAdminProposal.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/proposals/{proposalId}/reject:
 *   post:
 *     summary: Reject an administrative action proposal
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Proposal rejected
 *       400:
 *         description: Cannot reject proposal
 */
router.post(
  '/proposals/:proposalId/reject',
  authMiddleware,
  validate({ body: rejectAdminProposalSchema }),
  multisigController.rejectAdminProposal.bind(multisigController)
);

/**
 * @swagger
 * /api/multisig/proposals/{proposalId}/execute:
 *   post:
 *     summary: Execute an approved administrative action proposal
 *     description: Executes the proposal once the signature threshold is met
 *     tags: [Multisig]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Action executed successfully
 *       400:
 *         description: Threshold not met or execution failed
 */
router.post(
  '/proposals/:proposalId/execute',
  authMiddleware,
  multisigController.executeAdminProposal.bind(multisigController)
);

export default router;

