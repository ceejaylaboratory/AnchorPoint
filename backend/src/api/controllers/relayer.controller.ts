/**
 * Relayer Controller
 * 
 * API endpoints for signature-based gasless token approvals
 */

import { Request, Response } from 'express';
import { relayerService } from '../../services/relayer.service';
import {
  TokenApprovalRequest,
  SignedTransactionRequest,
} from '../../types/relayer.types';
import logger from '../../utils/logger';

/**
 * POST /api/relayer/approve
 * 
 * Submit a token approval request with signature
 * The relayer will verify the signature and submit the transaction
 */
export const submitApproval = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const approvalRequest: TokenApprovalRequest = req.body;

    // Validate required fields
    if (!approvalRequest.userPublicKey || !approvalRequest.signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userPublicKey and signature are required',
      });
    }

    if (!approvalRequest.spenderPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: spenderPublicKey is required',
      });
    }

    if (!approvalRequest.amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: amount is required',
      });
    }

    if (!approvalRequest.nonce) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: nonce is required',
      });
    }

    if (!approvalRequest.expiry) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: expiry is required',
      });
    }

    logger.info('Processing token approval request', {
      userPublicKey: approvalRequest.userPublicKey,
      spenderPublicKey: approvalRequest.spenderPublicKey,
      amount: approvalRequest.amount,
    });

    // Process the approval request
    const result = await relayerService.processApprovalRequest(approvalRequest);

    if (result.success) {
      return res.status(200).json({
        success: true,
        transactionHash: result.transactionHash,
        message: 'Token approval submitted successfully',
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    logger.error('Approval submission error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
};

/**
 * POST /api/relayer/verify
 * 
 * Verify a signature without submitting the transaction
 * Useful for pre-verification before submission
 */
export const verifySignature = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const approvalRequest: TokenApprovalRequest = req.body;

    // Validate required fields
    if (!approvalRequest.userPublicKey || !approvalRequest.signature) {
      return res.status(400).json({
        valid: false,
        error: 'Missing required fields: userPublicKey and signature are required',
      });
    }

    logger.info('Verifying signature', {
      userPublicKey: approvalRequest.userPublicKey,
    });

    // Verify the signature
    const result = await relayerService.verifySignature(approvalRequest);

    return res.status(200).json(result);
  } catch (error) {
    logger.error('Signature verification error:', error);
    return res.status(500).json({
      valid: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
};

/**
 * POST /api/relayer/submit
 * 
 * Submit a pre-signed transaction
 * The transaction should already be signed by the user
 */
export const submitSignedTransaction = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const signedTxRequest: SignedTransactionRequest = req.body;

    // Validate required fields
    if (!signedTxRequest.signedTransactionXdr) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: signedTransactionXdr is required',
      });
    }

    if (!signedTxRequest.networkPassphrase) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: networkPassphrase is required',
      });
    }

    logger.info('Submitting signed transaction');

    // Submit the transaction
    const result = await relayerService.submitSignedTransaction(signedTxRequest);

    if (result.success) {
      return res.status(200).json({
        success: true,
        transactionHash: result.transactionHash,
        message: 'Transaction submitted successfully',
      });
    } else {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    logger.error('Transaction submission error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
};

/**
 * GET /api/relayer/nonce
 * 
 * Generate a nonce for approval requests
 * Nonces should be unique and used to prevent replay attacks
 */
export const generateNonce = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const nonce = relayerService.generateNonce();

    return res.status(200).json({
      nonce,
      message: 'Nonce generated successfully',
    });
  } catch (error) {
    logger.error('Nonce generation error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
};

/**
 * GET /api/relayer/config
 * 
 * Get relayer configuration (public information only)
 */
export const getRelayerConfig = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const config = relayerService.getConfig();

    // Remove sensitive information
    const publicConfig = {
      relayerPublicKey: config.relayerPublicKey,
      maxAmount: config.maxAmount,
      allowedSpenders: config.allowedSpenders,
      expiryWindowSeconds: config.expiryWindowSeconds,
    };

    return res.status(200).json(publicConfig);
  } catch (error) {
    logger.error('Config retrieval error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
};
