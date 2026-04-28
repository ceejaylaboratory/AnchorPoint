import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import multisigService from '../../services/multisig.service';
import logger from '../../utils/logger';

export class MultisigController {
  /**
   * Create a new multisig transaction
   */
  async createTransaction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        envelopeXdr,
        requiredSigners,
        threshold,
        memo,
        expiresAt,
        metadata,
      } = req.body;

      const creatorPublicKey = req.user!.publicKey;

      const transaction = await multisigService.createTransaction({
        envelopeXdr,
        creatorPublicKey,
        requiredSigners,
        threshold,
        memo,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        metadata,
      });

      res.status(201).json({
        status: 'success',
        data: { transaction },
      });
    } catch (error: any) {
      logger.error('Error creating multisig transaction:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to create multisig transaction',
      });
    }
  }

  /**
   * Add a signature to a multisig transaction
   */
  async addSignature(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { transactionId } = req.params;
      const { signedEnvelopeXdr } = req.body;
      const signerPublicKey = req.user!.publicKey;

      const transaction = await multisigService.addSignature({
        transactionId,
        signerPublicKey,
        signedEnvelopeXdr,
      });

      res.json({
        status: 'success',
        data: { transaction },
      });
    } catch (error: any) {
      logger.error('Error adding signature:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to add signature',
      });
    }
  }

  /**
   * Get a multisig transaction by ID
   */
  async getTransaction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { transactionId } = req.params;

      const transaction = await multisigService.getTransaction(transactionId);

      if (!transaction) {
        res.status(404).json({
          status: 'error',
          message: 'Transaction not found',
        });
        return;
      }

      res.json({
        status: 'success',
        data: { transaction },
      });
    } catch (error: any) {
      logger.error('Error fetching transaction:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch transaction',
      });
    }
  }

  /**
   * Get multisig transactions for the authenticated user
   */
  async getMyTransactions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const publicKey = req.user!.publicKey;
      const { status } = req.query;

      const transactions = await multisigService.getTransactionsForSigner(
        publicKey,
        status as any
      );

      res.json({
        status: 'success',
        data: { transactions },
      });
    } catch (error: any) {
      logger.error('Error fetching transactions:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch transactions',
      });
    }
  }

  /**
   * Get pending transactions that need signature from the authenticated user
   */
  async getPendingTransactions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const publicKey = req.user!.publicKey;

      const transactions = await multisigService.getPendingForSigner(publicKey);

      res.json({
        status: 'success',
        data: { transactions },
      });
    } catch (error: any) {
      logger.error('Error fetching pending transactions:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch pending transactions',
      });
    }
  }

  /**
   * Manually submit a transaction
   */
  async submitTransaction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { transactionId } = req.params;

      const transaction = await multisigService.submitTransaction(transactionId);

      res.json({
        status: 'success',
        data: { transaction },
      });
    } catch (error: any) {
      logger.error('Error submitting transaction:', error);
      res.status(400).json({
        status: 'error',
        message: error.message || 'Failed to submit transaction',
      });
    }
  }

  /**
   * Get notifications for the authenticated user
   */
  async getNotifications(req: AuthRequest, res: Response): Promise<void> {
    try {
      const publicKey = req.user!.publicKey;
      const { unreadOnly } = req.query;

      const notifications = await multisigService.getNotifications(
        publicKey,
        unreadOnly === 'true'
      );

      res.json({
        status: 'success',
        data: { notifications },
      });
    } catch (error: any) {
      logger.error('Error fetching notifications:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch notifications',
      });
    }
  }

  /**
   * Mark notifications as read
   */
  async markNotificationsAsRead(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { notificationIds } = req.body;

      await multisigService.markNotificationsAsRead(notificationIds);

      res.json({
        status: 'success',
        message: 'Notifications marked as read',
      });
    } catch (error: any) {
      logger.error('Error marking notifications as read:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to mark notifications as read',
      });
    }
  }
}

export default new MultisigController();
