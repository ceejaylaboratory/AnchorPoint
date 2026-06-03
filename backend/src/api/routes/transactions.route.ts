import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { stellarService } from '../../services/stellar.service';
import { submissionLimiter } from '../middleware/rate-limit.middleware';


const router = Router();

const querySchema = z.object({
  page: z.string().optional().transform(v => parseInt(v || '1', 10)).pipe(z.number().min(1)),
  limit: z.string().optional().transform(v => parseInt(v || '10', 10)).pipe(z.number().min(1).max(50)),
  assetCode: z.string().optional(),
  sender: z.string().optional(),
  receiver: z.string().optional(),
  memo: z.string().optional(),
  cursor: z.string().optional(),
});

const submitSchema = z.object({
  xdr: z.string().min(1, 'Transaction XDR is required'),
});


/**
 * @swagger
 * /api/transactions:
 *   get:
 *     summary: Get transaction history
 *     description: Fetches transaction history for the authenticated user with pagination support.
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: assetCode
 *         schema:
 *           type: string
 *         description: Filter transactions by asset code (e.g., USDC, BTC)
 *       - in: query
 *         name: sender
 *         schema:
 *           type: string
 *         description: Search for transactions with matching sender metadata in indexed events
 *       - in: query
 *         name: receiver
 *         schema:
 *           type: string
 *         description: Search for transactions with matching receiver metadata in indexed events
 *       - in: query
 *         name: memo
 *         schema:
 *           type: string
 *         description: Search for transactions by memo or indexed event text
 *     responses:
 *       200:
 *         description: Transaction history retrieved successfully
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
 *                         $ref: '#/components/schemas/Transaction'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *       401:
 *         description: Unauthorized - Invalid or missing authentication token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', authMiddleware, validate({ query: querySchema }), async (req: AuthRequest, res: Response) => {
  const { page, limit, assetCode, sender, receiver, memo, cursor } = req.query as unknown as {
    page: number;
    limit: number;
    assetCode?: string;
    sender?: string;
    receiver?: string;
    memo?: string;
    cursor?: string;
  };
  const publicKey = req.user!.publicKey;

  try {
    const user = await prisma.user.findUnique({ where: { publicKey } });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const eventSearchClauses: string[] = [];
    const eventQueryParams: string[] = [];

    if (sender) {
      const senderPattern = `%${sender}%`;
      eventSearchClauses.push('(topics LIKE ? OR value LIKE ?)');
      eventQueryParams.push(senderPattern, senderPattern);
    }

    if (receiver) {
      const receiverPattern = `%${receiver}%`;
      eventSearchClauses.push('(topics LIKE ? OR value LIKE ?)');
      eventQueryParams.push(receiverPattern, receiverPattern);
    }

    if (memo) {
      const memoPattern = `%${memo}%`;
      eventSearchClauses.push('(topics LIKE ? OR value LIKE ?)');
      eventQueryParams.push(memoPattern, memoPattern);
    }

    let matchingTxHashes: string[] | undefined;

    if (eventSearchClauses.length > 0) {
      const eventRows = await prisma.$queryRaw<Array<{ txHash: string }>>(
        `SELECT DISTINCT txHash FROM "ContractEvent" WHERE ${eventSearchClauses.join(' AND ')}`,
        ...eventQueryParams,
      );

      matchingTxHashes = eventRows.map((row: { txHash: string }) => row.txHash).filter(Boolean);
      if (matchingTxHashes.length === 0) {
        return res.json({
          status: 'success',
          data: {
            transactions: [],
            pagination: { total: 0, page, limit, totalPages: 0 },
          },
        });
      }
    }

    const whereClause: any = {
      userId: user.id,
      ...(assetCode && { assetCode }),
      ...(matchingTxHashes ? { stellarTxId: { in: matchingTxHashes } } : {}),
    };

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : { skip }),
      }),
      prisma.transaction.count({
        where: whereClause,
      }),
    ]);

    res.json({
      status: 'success',
      data: {
        transactions,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch transaction history',
    });
  }
});

/**
 * @swagger
 * /api/transactions/submit:
 *   post:
 *     summary: Submit a pre-signed transaction
 *     description: Validates and submits a pre-signed Stellar transaction XDR to the network.
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - xdr
 *             properties:
 *               xdr:
 *                 type: string
 *                 description: Base64 encoded transaction XDR
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
 *                     hash:
 *                       type: string
 *                     ledger:
 *                       type: number
 *       400:
 *         description: Invalid transaction or disallowed operation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/submit', authMiddleware, submissionLimiter, validate({ body: submitSchema }), async (req: AuthRequest, res: Response) => {
  const { xdr } = req.body;

  try {
    const result = await stellarService.submitTransaction(xdr);
    res.json({
      status: 'success',
      data: {
        hash: result.hash,
        ledger: result.ledger,
      },
    });
  } catch (error: any) {
    res.status(400).json({
      status: 'error',
      message: error.message,
    });
  }
});

export default router;

