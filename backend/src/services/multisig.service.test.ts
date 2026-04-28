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
        hash: 'abc123',
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
        signatures: [],
      };

      (prisma.multisigTransaction.findUnique as jest.Mock).mockResolvedValue(mockTx);
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockTransaction);
      (prisma.multisigSignature.create as jest.Mock).mockResolvedValue({
        id: 'sig-123',
        signerPublicKey: mockPublicKey1,
      });

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
        hash: 'abc123',
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
        hash: 'abc123',
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
        hash: 'abc123',
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

  describe('getTransaction', () => {
    it('should retrieve transaction by ID', async () => {
      const mockTx = {
        id: 'tx-123',
        hash: 'abc123',
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
});
