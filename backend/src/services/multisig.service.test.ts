import multisigService from './multisig.service';
import prisma from '../lib/prisma';
import * as StellarSdk from '@stellar/stellar-sdk';
import { MultisigStatus } from '@prisma/client';

// Mock dependencies
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    multisigTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    multisigSignature: {
      create: jest.fn(),
    },
    multisigNotification: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('@stellar/stellar-sdk');

describe('MultisigService', () => {
  const mockPublicKey1 = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX1';
  const mockPublicKey2 = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX2';
  const mockPublicKey3 = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX3';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createTransaction', () => {
    it('should create a multisig transaction successfully', async () => {
      const mockEnvelopeXdr = 'AAAAAA==';
      const mockHash = 'abc123';
      
      // Mock Stellar SDK
      const mockTransaction = {
        hash: () => Buffer.from(mockHash, 'utf8'),
      };
      
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTransaction);

      const mockCreatedTx = {
        id: 'tx-123',
        envelopeXdr: mockEnvelopeXdr,
        hash: mockHash,
        creatorPublicKey: mockPublicKey1,
        requiredSigners: [mockPublicKey1, mockPublicKey2, mockPublicKey3],
        threshold: 2,
        currentSignatures: 0,
        status: MultisigStatus.PENDING,
        signatures: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigTransaction.create as jest.Mock).mockResolvedValue(mockCreatedTx);
      (prisma.multisigNotification.createMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await multisigService.createTransaction({
        envelopeXdr: mockEnvelopeXdr,
        creatorPublicKey: mockPublicKey1,
        requiredSigners: [mockPublicKey1, mockPublicKey2, mockPublicKey3],
        threshold: 2,
      });

      expect(result.id).toBe('tx-123');
      expect(result.threshold).toBe(2);
      expect(result.requiredSigners).toHaveLength(3);
      expect(prisma.multisigNotification.createMany).toHaveBeenCalled();
    });

    it('should reject invalid threshold', async () => {
      await expect(
        multisigService.createTransaction({
          envelopeXdr: 'AAAAAA==',
          creatorPublicKey: mockPublicKey1,
          requiredSigners: [mockPublicKey1, mockPublicKey2],
          threshold: 3, // More than number of signers
        })
      ).rejects.toThrow('Invalid threshold');
    });

    it('should reject duplicate signers', async () => {
      const mockTransaction = {
        hash: () => Buffer.from('abc123', 'utf8'),
      };
      
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTransaction);

      await expect(
        multisigService.createTransaction({
          envelopeXdr: 'AAAAAA==',
          creatorPublicKey: mockPublicKey1,
          requiredSigners: [mockPublicKey1, mockPublicKey1], // Duplicate
          threshold: 1,
        })
      ).rejects.toThrow('Duplicate signers are not allowed');
    });

    it('should reject past expiration date', async () => {
      const mockTransaction = {
        hash: () => Buffer.from('abc123', 'utf8'),
      };
      
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTransaction);

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      await expect(
        multisigService.createTransaction({
          envelopeXdr: 'AAAAAA==',
          creatorPublicKey: mockPublicKey1,
          requiredSigners: [mockPublicKey1, mockPublicKey2],
          threshold: 1,
          expiresAt: pastDate,
        })
      ).rejects.toThrow('Expiration date must be in the future');
    });
  });

  describe('addSignature', () => {
    it('should add signature successfully', async () => {
      const mockTx = {
        id: 'tx-123',
        hash: Buffer.from('abc123', 'utf8').toString('hex'),
        envelopeXdr: 'AAAAAA==',
        requiredSigners: [mockPublicKey1, mockPublicKey2],
        threshold: 2,
        currentSignatures: 0,
        status: MultisigStatus.PENDING,
        signatures: [],
        expiresAt: null,
      };

      const mockTransaction = {
        hash: () => Buffer.from('abc123', 'utf8'),
        signatures: [
          {
            hint: () => Buffer.from('1234', 'hex'),
            signature: () => Buffer.from('signed-bytes'),
          },
        ],
      };

      (prisma.multisigTransaction.findUnique as jest.Mock).mockResolvedValue(mockTx);
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTransaction);
      (prisma.multisigSignature.create as jest.Mock).mockResolvedValue({
        id: 'sig-123',
        signerPublicKey: mockPublicKey1,
      });
      (multisigService as any).extractSignature = jest.fn().mockReturnValue('signature-base64');
      (multisigService as any).mergeSignatures = jest.fn().mockResolvedValue('merged-envelope');

      const updatedTx = {
        ...mockTx,
        currentSignatures: 1,
        status: MultisigStatus.PARTIALLY_SIGNED,
        signatures: [{ signerPublicKey: mockPublicKey1, signedAt: new Date() }],
      };

      (prisma.multisigTransaction.update as jest.Mock).mockResolvedValue(updatedTx);

      const result = await multisigService.addSignature({
        transactionId: 'tx-123',
        signerPublicKey: mockPublicKey1,
        signedEnvelopeXdr: 'AAAAAA==',
      });

      expect(result.currentSignatures).toBe(1);
      expect(result.status).toBe(MultisigStatus.PARTIALLY_SIGNED);
    });

    it('should reject signature from non-required signer', async () => {
      const mockTx = {
        id: 'tx-123',
        hash: Buffer.from('abc123', 'utf8').toString('hex'),
        requiredSigners: [mockPublicKey1, mockPublicKey2],
        threshold: 2,
        status: MultisigStatus.PENDING,
        signatures: [],
        expiresAt: null,
      };

      (prisma.multisigTransaction.findUnique as jest.Mock).mockResolvedValue(mockTx);

      await expect(
        multisigService.addSignature({
          transactionId: 'tx-123',
          signerPublicKey: mockPublicKey3, // Not in required signers
          signedEnvelopeXdr: 'AAAAAA==',
        })
      ).rejects.toThrow('Signer is not in the required signers list');
    });

    it('should reject duplicate signature', async () => {
      const mockTx = {
        id: 'tx-123',
        hash: Buffer.from('abc123', 'utf8').toString('hex'),
        requiredSigners: [mockPublicKey1, mockPublicKey2],
        threshold: 2,
        status: MultisigStatus.PARTIALLY_SIGNED,
        signatures: [{ signerPublicKey: mockPublicKey1, signedAt: new Date() }],
        expiresAt: null,
      };

      (prisma.multisigTransaction.findUnique as jest.Mock).mockResolvedValue(mockTx);

      await expect(
        multisigService.addSignature({
          transactionId: 'tx-123',
          signerPublicKey: mockPublicKey1, // Already signed
          signedEnvelopeXdr: 'AAAAAA==',
        })
      ).rejects.toThrow('Signer has already signed this transaction');
    });

    it('should reject signature for expired transaction', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const mockTx = {
        id: 'tx-123',
        hash: Buffer.from('abc123', 'utf8').toString('hex'),
        requiredSigners: [mockPublicKey1, mockPublicKey2],
        threshold: 2,
        status: MultisigStatus.PENDING,
        signatures: [],
        expiresAt: pastDate,
      };

      (prisma.multisigTransaction.findUnique as jest.Mock).mockResolvedValue(mockTx);
      (prisma.multisigTransaction.update as jest.Mock).mockResolvedValue({
        ...mockTx,
        status: MultisigStatus.EXPIRED,
      });

      await expect(
        multisigService.addSignature({
          transactionId: 'tx-123',
          signerPublicKey: mockPublicKey1,
          signedEnvelopeXdr: 'AAAAAA==',
        })
      ).rejects.toThrow('Transaction has expired');
    });
  });

  describe('threshold re-evaluation (#1527)', () => {
    const baseTx = {
      hash: Buffer.from('abc123', 'utf8').toString('hex'),
      envelopeXdr: 'AAAAAA==',
      creatorPublicKey: mockPublicKey1,
      requiredSigners: [mockPublicKey1, mockPublicKey2, mockPublicKey3],
      expiresAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const sig = (signerPublicKey: string) => ({ signerPublicKey, signedAt: new Date() });

    let attemptSubmission: jest.SpyInstance;

    beforeEach(() => {
      attemptSubmission = jest
        .spyOn(multisigService as any, 'attemptSubmission')
        .mockImplementation(async (id: any) => ({ id, status: MultisigStatus.SUBMITTED }));
      (prisma.multisigTransaction.update as jest.Mock).mockImplementation(async ({ where, data }) => ({
        ...baseTx,
        id: where.id,
        signatures: [],
        ...data,
      }));
      (prisma.multisigNotification.createMany as jest.Mock).mockResolvedValue({ count: 0 });
    });

    afterEach(() => {
      attemptSubmission.mockRestore();
    });

    it('evaluateStatus maps signature count and threshold to a status', () => {
      expect(multisigService.evaluateStatus(0, 2)).toBe(MultisigStatus.PENDING);
      expect(multisigService.evaluateStatus(1, 2)).toBe(MultisigStatus.PARTIALLY_SIGNED);
      expect(multisigService.evaluateStatus(2, 2)).toBe(MultisigStatus.READY);
      expect(multisigService.evaluateStatus(3, 2)).toBe(MultisigStatus.READY);
    });

    it('addSignature uses the current threshold when it was increased after signatures were collected', async () => {
      const stale = {
        ...baseTx,
        id: 'tx-1',
        threshold: 2,
        currentSignatures: 1,
        status: MultisigStatus.PARTIALLY_SIGNED,
        signatures: [sig(mockPublicKey1)],
      };
      const fresh = { ...stale, threshold: 3, signatures: [sig(mockPublicKey1), sig(mockPublicKey2)] };

      (prisma.multisigTransaction.findUnique as jest.Mock)
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce(fresh);
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue({
        hash: () => Buffer.from('abc123', 'utf8'),
        signatures: [],
      });
      (prisma.multisigSignature.create as jest.Mock).mockResolvedValue({});
      const extract = jest.spyOn(multisigService as any, 'extractSignature').mockReturnValue('sig');
      const merge = jest.spyOn(multisigService as any, 'mergeSignatures').mockResolvedValue('merged');

      const result = await multisigService.addSignature({
        transactionId: 'tx-1',
        signerPublicKey: mockPublicKey2,
        signedEnvelopeXdr: 'AAAAAA==',
      });

      expect(prisma.multisigTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentSignatures: 2,
            status: MultisigStatus.PARTIALLY_SIGNED,
          }),
        })
      );
      expect(result.status).toBe(MultisigStatus.PARTIALLY_SIGNED);
      expect(attemptSubmission).not.toHaveBeenCalled();

      extract.mockRestore();
      merge.mockRestore();
    });

    it('updateThreshold re-evaluates a READY transaction when the threshold is increased', async () => {
      const ready = {
        ...baseTx,
        id: 'tx-2',
        threshold: 2,
        currentSignatures: 2,
        status: MultisigStatus.READY,
        signatures: [sig(mockPublicKey1), sig(mockPublicKey2)],
      };

      (prisma.multisigTransaction.findUnique as jest.Mock)
        .mockResolvedValueOnce(ready)
        .mockResolvedValueOnce({ ...ready, threshold: 3 });

      const result = await multisigService.updateThreshold('tx-2', 3);

      expect(prisma.multisigTransaction.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'tx-2' },
        data: { threshold: 3 },
      });
      expect(prisma.multisigTransaction.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: { status: MultisigStatus.PARTIALLY_SIGNED, currentSignatures: 2 },
        })
      );
      expect(result.status).toBe(MultisigStatus.PARTIALLY_SIGNED);
      expect(attemptSubmission).not.toHaveBeenCalled();
    });

    it('updateThreshold rejects thresholds outside the signer range', async () => {
      (prisma.multisigTransaction.findUnique as jest.Mock).mockResolvedValueOnce({
        ...baseTx,
        id: 'tx-3',
        threshold: 2,
        currentSignatures: 0,
        status: MultisigStatus.PENDING,
        signatures: [],
      });

      await expect(multisigService.updateThreshold('tx-3', 4)).rejects.toThrow('Invalid threshold');
      expect(prisma.multisigTransaction.update).not.toHaveBeenCalled();
    });

    it('reconcilePendingTransactions corrects drifted statuses, expires stale ones and submits ready ones', async () => {
      const txs: Record<string, any> = {
        // Stuck in PENDING although two signatures exist (threshold 3).
        stuck: {
          ...baseTx,
          id: 'stuck',
          threshold: 3,
          currentSignatures: 0,
          status: MultisigStatus.PENDING,
          signatures: [sig(mockPublicKey1), sig(mockPublicKey2)],
        },
        // Threshold met but never promoted to READY.
        ready: {
          ...baseTx,
          id: 'ready',
          threshold: 2,
          currentSignatures: 1,
          status: MultisigStatus.PARTIALLY_SIGNED,
          signatures: [sig(mockPublicKey1), sig(mockPublicKey3)],
        },
        // Already consistent.
        ok: {
          ...baseTx,
          id: 'ok',
          threshold: 2,
          currentSignatures: 1,
          status: MultisigStatus.PARTIALLY_SIGNED,
          signatures: [sig(mockPublicKey1)],
        },
        expired: {
          ...baseTx,
          id: 'expired',
          threshold: 2,
          currentSignatures: 0,
          status: MultisigStatus.PENDING,
          signatures: [],
          expiresAt: new Date(Date.now() - 1000),
        },
      };

      (prisma.multisigTransaction.findMany as jest.Mock).mockResolvedValue(
        Object.keys(txs).map(id => ({ id }))
      );
      (prisma.multisigTransaction.findUnique as jest.Mock).mockImplementation(
        async ({ where }) => txs[where.id]
      );

      const summary = await multisigService.reconcilePendingTransactions();

      expect(summary).toEqual({ checked: 4, updated: 3, failed: 0 });
      expect(prisma.multisigTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: {
              in: [MultisigStatus.PENDING, MultisigStatus.PARTIALLY_SIGNED, MultisigStatus.READY],
            },
          },
        })
      );
      expect(prisma.multisigTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'stuck' },
          data: { status: MultisigStatus.PARTIALLY_SIGNED, currentSignatures: 2 },
        })
      );
      expect(prisma.multisigTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ready' },
          data: { status: MultisigStatus.READY, currentSignatures: 2 },
        })
      );
      expect(prisma.multisigTransaction.update).toHaveBeenCalledWith({
        where: { id: 'expired' },
        data: { status: MultisigStatus.EXPIRED },
      });
      expect(prisma.multisigTransaction.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ok' } })
      );
      expect(attemptSubmission).toHaveBeenCalledTimes(1);
      expect(attemptSubmission).toHaveBeenCalledWith('ready');
    });

    it('reconcilePendingTransactions keeps going when one transaction fails', async () => {
      (prisma.multisigTransaction.findMany as jest.Mock).mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      (prisma.multisigTransaction.findUnique as jest.Mock).mockImplementation(async ({ where }) => {
        if (where.id === 'a') throw new Error('db down');
        return {
          ...baseTx,
          id: 'b',
          threshold: 3,
          currentSignatures: 0,
          status: MultisigStatus.PENDING,
          signatures: [sig(mockPublicKey1)],
        };
      });

      const summary = await multisigService.reconcilePendingTransactions();

      expect(summary).toEqual({ checked: 2, updated: 1, failed: 1 });
    });
  });

  describe('getTransaction', () => {
    it('should retrieve transaction by ID', async () => {
      const mockTx = {
        id: 'tx-123',
        hash: Buffer.from('abc123', 'utf8').toString('hex'),
        envelopeXdr: 'AAAAAA==',
        creatorPublicKey: mockPublicKey1,
        requiredSigners: [mockPublicKey1, mockPublicKey2],
        threshold: 2,
        currentSignatures: 1,
        status: MultisigStatus.PARTIALLY_SIGNED,
        signatures: [{ signerPublicKey: mockPublicKey1, signedAt: new Date() }],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.multisigTransaction.findUnique as jest.Mock).mockResolvedValue(mockTx);

      const result = await multisigService.getTransaction('tx-123');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('tx-123');
      expect(result?.currentSignatures).toBe(1);
    });

    it('should return null for non-existent transaction', async () => {
      (prisma.multisigTransaction.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await multisigService.getTransaction('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getPendingForSigner', () => {
    it('should return pending transactions for signer', async () => {
      const mockTxs = [
        {
          id: 'tx-1',
          hash: 'hash1',
          requiredSigners: [mockPublicKey1, mockPublicKey2],
          status: MultisigStatus.PENDING,
          signatures: [],
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'tx-2',
          hash: 'hash2',
          requiredSigners: [mockPublicKey1, mockPublicKey3],
          status: MultisigStatus.PARTIALLY_SIGNED,
          signatures: [{ signerPublicKey: mockPublicKey3, signedAt: new Date() }],
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (prisma.multisigTransaction.findMany as jest.Mock).mockResolvedValue(mockTxs);

      const result = await multisigService.getPendingForSigner(mockPublicKey1);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('tx-1');
      expect(result[1].id).toBe('tx-2');
    });

    it('should filter out transactions already signed by user', async () => {
      const mockTxs = [
        {
          id: 'tx-1',
          hash: 'hash1',
          requiredSigners: [mockPublicKey1, mockPublicKey2],
          status: MultisigStatus.PARTIALLY_SIGNED,
          signatures: [{ signerPublicKey: mockPublicKey1, signedAt: new Date() }],
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (prisma.multisigTransaction.findMany as jest.Mock).mockResolvedValue(mockTxs);

      const result = await multisigService.getPendingForSigner(mockPublicKey1);

      expect(result).toHaveLength(0);
    });
  });

  describe('getNotifications', () => {
    it('should retrieve all notifications for user', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          recipientPublicKey: mockPublicKey1,
          type: 'SIGNATURE_REQUIRED',
          message: 'Your signature is required',
          sentAt: new Date(),
          readAt: null,
        },
        {
          id: 'notif-2',
          recipientPublicKey: mockPublicKey1,
          type: 'SIGNATURE_ADDED',
          message: 'A signature was added',
          sentAt: new Date(),
          readAt: new Date(),
        },
      ];

      (prisma.multisigNotification.findMany as jest.Mock).mockResolvedValue(mockNotifications);

      const result = await multisigService.getNotifications(mockPublicKey1, false);

      expect(result).toHaveLength(2);
    });

    it('should retrieve only unread notifications', async () => {
      const mockNotifications = [
        {
          id: 'notif-1',
          recipientPublicKey: mockPublicKey1,
          type: 'SIGNATURE_REQUIRED',
          message: 'Your signature is required',
          sentAt: new Date(),
          readAt: null,
        },
      ];

      (prisma.multisigNotification.findMany as jest.Mock).mockResolvedValue(mockNotifications);

      const result = await multisigService.getNotifications(mockPublicKey1, true);

      expect(result).toHaveLength(1);
      expect(result[0].readAt).toBeNull();
    });
  });

  describe('markNotificationsAsRead', () => {
    it('should mark notifications as read', async () => {
      (prisma.multisigNotification.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

      await multisigService.markNotificationsAsRead(['notif-1', 'notif-2']);

      expect(prisma.multisigNotification.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['notif-1', 'notif-2'] },
        },
        data: {
          readAt: expect.any(Date),
        },
      });
    });
  });

  describe('parseTransactionPayload', () => {
    const signerA = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const signerB = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

    it('parses XDR and reports missing weight relative to account signers', () => {
      const hintA = Buffer.from([1, 2, 3, 4]);
      const hintB = Buffer.from([5, 6, 7, 8]);

      const mockKeypairA = {
        rawPublicKey: () => Buffer.concat([Buffer.alloc(28), hintA]),
      };
      const mockKeypairB = {
        rawPublicKey: () => Buffer.concat([Buffer.alloc(28), hintB]),
      };

      (StellarSdk.Keypair.fromPublicKey as jest.Mock).mockImplementation((pk: string) => {
        if (pk === signerA) return mockKeypairA;
        if (pk === signerB) return mockKeypairB;
        throw new Error('unknown');
      });

      const mockTx = {
        hash: () => Buffer.from('deadbeef', 'hex'),
        source: signerA,
        signatures: [
          {
            hint: () => hintA,
            signature: () => Buffer.from('sig'),
          },
        ],
      };

      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTx);
      (StellarSdk as any).FeeBumpTransaction = class FeeBumpTransaction {};
      (StellarSdk as any).Networks = { TESTNET: 'Test SDF Network ; September 2015' };

      const result = multisigService.parseTransactionPayload(
        'AAAAAA==',
        [
          { publicKey: signerA, weight: 1 },
          { publicKey: signerB, weight: 1 },
        ],
        2
      );

      expect(result.hash).toBe('deadbeef');
      expect(result.collectedWeight).toBe(1);
      expect(result.requiredThreshold).toBe(2);
      expect(result.missingWeight).toBe(1);
      expect(result.thresholdMet).toBe(false);
      expect(result.signedKeys).toEqual([signerA]);
      expect(result.missingSigners).toEqual([{ publicKey: signerB, weight: 1 }]);
      expect(result.signaturesPresent).toHaveLength(1);
    });

    it('reports thresholdMet when collected weight meets threshold', () => {
      const hintA = Buffer.from([1, 2, 3, 4]);
      const mockKeypairA = {
        rawPublicKey: () => Buffer.concat([Buffer.alloc(28), hintA]),
      };

      (StellarSdk.Keypair.fromPublicKey as jest.Mock).mockReturnValue(mockKeypairA);

      const mockTx = {
        hash: () => Buffer.from('cafebabe', 'hex'),
        source: signerA,
        signatures: [
          { hint: () => hintA, signature: () => Buffer.from('sig') },
        ],
      };

      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTx);
      (StellarSdk as any).FeeBumpTransaction = class FeeBumpTransaction {};
      (StellarSdk as any).Networks = { TESTNET: 'Test SDF Network ; September 2015' };

      const result = multisigService.parseTransactionPayload(
        'AAAAAA==',
        [{ publicKey: signerA, weight: 2 }],
        2
      );

      expect(result.thresholdMet).toBe(true);
      expect(result.missingWeight).toBe(0);
      expect(result.missingSigners).toHaveLength(0);
    });

    it('rejects invalid XDR', () => {
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockImplementation(() => {
        throw new Error('bad xdr');
      });

      expect(() =>
        multisigService.parseTransactionPayload('!!!', [{ publicKey: signerA, weight: 1 }], 1)
      ).toThrow('Invalid transaction envelope XDR');
    });
  });
});
