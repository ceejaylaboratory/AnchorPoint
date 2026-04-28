import { Response } from 'express';
import { randomUUID } from 'crypto';
import prisma from '../../lib/prisma';
import { AuthRequest } from '../middleware/auth.middleware';
import { getAsset, isDepositSupported, isWithdrawSupported, normalizeAssetCode } from '../../services/kyc.service';
import { ASSETS } from '../../config/assets';

/**
 * GET /sep6/info
 * Returns supported assets and capabilities for SEP-6.
 */
export const sep6Info = (_req: AuthRequest, res: Response): Response => {
  const deposit: Record<string, object> = {};
  const withdraw: Record<string, object> = {};

  for (const asset of ASSETS) {
    if (asset.depositEnabled) {
      deposit[asset.code] = {
        enabled: true,
        min_amount: asset.minAmount,
        max_amount: asset.maxAmount,
        fee_fixed: asset.feeFixed,
        fee_percent: asset.feePercent,
        fields: {
          email_address: { description: 'Email address of the depositor', optional: true },
          first_name: { description: 'First name of the depositor', optional: true },
          last_name: { description: 'Last name of the depositor', optional: true },
        },
      };
    }
    if (asset.withdrawEnabled) {
      withdraw[asset.code] = {
        enabled: true,
        min_amount: asset.minAmount,
        max_amount: asset.maxAmount,
        fee_fixed: asset.feeFixed,
        fee_percent: asset.feePercent,
        types: {
          bank_account: { fields: { dest: { description: 'Bank account number' }, dest_extra: { description: 'Bank routing number', optional: true } } },
          crypto: { fields: { dest: { description: 'Destination crypto address' } } },
        },
      };
    }
  }

  return res.json({ deposit, withdraw });
};

/**
 * GET /sep6/deposit
 * SEP-6 non-interactive deposit. Creates a pending transaction and returns instructions.
 */
export const sep6Deposit = async (req: AuthRequest, res: Response): Promise<Response> => {
  const { asset_code, amount, email_address } = req.query as Record<string, string>;
  const publicKey = req.user!.publicKey;
  const code = normalizeAssetCode(asset_code);

  if (!isDepositSupported(code)) {
    return res.status(400).json({ error: `Asset ${asset_code} is not supported for deposit.` });
  }

  const asset = getAsset(code)!;

  if (amount) {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < parseFloat(asset.minAmount) || amt > parseFloat(asset.maxAmount)) {
      return res.status(400).json({
        error: `Amount must be between ${asset.minAmount} and ${asset.maxAmount} for ${code}.`,
      });
    }
  }

  try {
    const tx = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        user: {
          connectOrCreate: {
            where: { publicKey },
            create: {
              publicKey,
              ...(email_address ? { email: email_address } : {}),
            },
          },
        },
        assetCode: code,
        amount: amount || '0',
        type: 'DEPOSIT',
        status: 'PENDING',
      },
    });

    return res.json({
      how: `Send ${code} to the anchor's receiving account.`,
      id: tx.id,
      eta: 1800,
      min_amount: asset.minAmount,
      max_amount: asset.maxAmount,
      fee_fixed: asset.feeFixed,
      fee_percent: asset.feePercent,
      extra_info: {
        message: 'Include the transaction ID as the memo when sending funds.',
        memo: tx.id,
        memo_type: 'text',
        receiving_account: process.env.RECEIVING_ACCOUNT || 'GD5DJQDKEBTHBQC7LKLDSLRGEA3KMRMFOKMJUEKSFZLWQ5E2PJDJYZNF',
      },
    });
  } catch (error) {
    console.error('SEP-6 deposit error:', error);
    return res.status(500).json({ error: 'Failed to initiate deposit.' });
  }
};

/**
 * GET /sep6/withdraw
 * SEP-6 non-interactive withdrawal. Creates a pending transaction and returns instructions.
 */
export const sep6Withdraw = async (req: AuthRequest, res: Response): Promise<Response> => {
  const { asset_code, amount, dest, dest_extra, type = 'bank_account' } = req.query as Record<string, string>;
  const publicKey = req.user!.publicKey;
  const code = normalizeAssetCode(asset_code);

  if (!isWithdrawSupported(code)) {
    return res.status(400).json({ error: `Asset ${asset_code} is not supported for withdrawal.` });
  }

  if (!dest) {
    return res.status(400).json({ error: 'dest is required for withdrawal.' });
  }

  const asset = getAsset(code)!;

  if (amount) {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < parseFloat(asset.minAmount) || amt > parseFloat(asset.maxAmount)) {
      return res.status(400).json({
        error: `Amount must be between ${asset.minAmount} and ${asset.maxAmount} for ${code}.`,
      });
    }
  }

  try {
    const tx = await prisma.transaction.create({
      data: {
        id: randomUUID(),
        user: {
          connectOrCreate: {
            where: { publicKey },
            create: { publicKey },
          },
        },
        assetCode: code,
        amount: amount || '0',
        type: 'WITHDRAW',
        status: 'PENDING',
      },
    });

    return res.json({
      account_id: process.env.RECEIVING_ACCOUNT || 'GD5DJQDKEBTHBQC7LKLDSLRGEA3KMRMFOKMJUEKSFZLWQ5E2PJDJYZNF',
      memo_type: 'text',
      memo: tx.id,
      id: tx.id,
      eta: 3600,
      min_amount: asset.minAmount,
      max_amount: asset.maxAmount,
      fee_fixed: asset.feeFixed,
      fee_percent: asset.feePercent,
      extra_info: {
        message: `Send ${code} to the anchor account with the memo. Funds will be sent to ${dest}${dest_extra ? ` (routing: ${dest_extra})` : ''}.`,
        type,
        dest,
        dest_extra,
      },
    });
  } catch (error) {
    console.error('SEP-6 withdraw error:', error);
    return res.status(500).json({ error: 'Failed to initiate withdrawal.' });
  }
};

/**
 * GET /sep6/transaction
 * Returns a single SEP-6 transaction by id or stellar_transaction_id.
 */
export const sep6GetTransaction = async (req: AuthRequest, res: Response): Promise<Response> => {
  const { id, stellar_transaction_id, external_transaction_id } = req.query as Record<string, string>;
  const publicKey = req.user!.publicKey;

  if (!id && !stellar_transaction_id && !external_transaction_id) {
    return res.status(400).json({ error: 'One of id, stellar_transaction_id, or external_transaction_id is required.' });
  }

  try {
    const tx = await prisma.transaction.findFirst({
      where: {
        user: { publicKey },
        ...(id && { id }),
        ...(stellar_transaction_id && { stellarTxId: stellar_transaction_id }),
        ...(external_transaction_id && { externalId: external_transaction_id }),
      },
    });

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found.' });
    }

    return res.json({ transaction: formatTransaction(tx) });
  } catch (error) {
    console.error('SEP-6 get transaction error:', error);
    return res.status(500).json({ error: 'Failed to fetch transaction.' });
  }
};

/**
 * GET /sep6/transactions
 * Returns transaction history for the authenticated user.
 */
export const sep6GetTransactions = async (req: AuthRequest, res: Response): Promise<Response> => {
  const { asset_code, limit = '10', paging_id, no_older_than } = req.query as Record<string, string>;
  const publicKey = req.user!.publicKey;

  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        user: { publicKey },
        ...(asset_code && { assetCode: normalizeAssetCode(asset_code) }),
        ...(no_older_than && { createdAt: { gte: new Date(no_older_than) } }),
        ...(paging_id && { id: { gt: paging_id } }),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit, 10) || 10, 200),
    });

    return res.json({ transactions: transactions.map(formatTransaction) });
  } catch (error) {
    console.error('SEP-6 get transactions error:', error);
    return res.status(500).json({ error: 'Failed to fetch transactions.' });
  }
};

function formatTransaction(tx: {
  id: string;
  assetCode: string;
  amount: string;
  type: string;
  status: string;
  externalId: string | null;
  stellarTxId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: tx.id,
    kind: tx.type.toLowerCase(),
    status: tx.status.toLowerCase(),
    amount_in: tx.type === 'DEPOSIT' ? tx.amount : undefined,
    amount_out: tx.type === 'WITHDRAW' ? tx.amount : undefined,
    asset_code: tx.assetCode,
    stellar_transaction_id: tx.stellarTxId,
    external_transaction_id: tx.externalId,
    started_at: tx.createdAt.toISOString(),
    completed_at: tx.status === 'COMPLETED' ? tx.updatedAt.toISOString() : undefined,
  };
}
