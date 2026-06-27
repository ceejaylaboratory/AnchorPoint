// IMPLEMENTATION APPROACH: Option A — Node.js/TypeScript + Express
// Rationale: Express routing mirrors Horizon's RESTful structure naturally.

import { Router, Request, Response } from 'express';
import { getActiveScenario, ScenarioName, handleScenarioDelay } from '../scenarios';

export const horizonRouter = Router();

horizonRouter.get('/accounts/:account_id', async (req: Request, res: Response): Promise<void> => {
  await handleScenarioDelay();
  const scenario = getActiveScenario();

  if (scenario === ScenarioName.ACCOUNT_NOT_FOUND) {
    res.status(404).json({
      type: 'https://stellar.org/horizon-errors/not_found',
      title: 'Resource Missing',
      status: 404,
      detail: 'The resource at the url requested was not found.',
    });
    return;
  }

  res.status(200).json({
    id: req.params.account_id,
    account_id: req.params.account_id,
    sequence: '123456789012345678',
    balances: [
      {
        balance: '10000.0000000',
        asset_type: 'native',
      },
    ],
  });
});

horizonRouter.post('/transactions', async (req: Request, res: Response): Promise<void> => {
  await handleScenarioDelay();
  const scenario = getActiveScenario();

  if (scenario === ScenarioName.TRANSACTION_FAILED) {
    res.status(400).json({
      type: 'https://stellar.org/horizon-errors/transaction_failed',
      title: 'Transaction Failed',
      status: 400,
      extras: { result_codes: { transaction: 'tx_failed' } },
    });
    return;
  }

  res.status(200).json({
    hash: 'mock_tx_hash_1234567890abcdef',
    ledger: 1000,
    successful: true,
  });
});

horizonRouter.get('/fee_stats', async (req: Request, res: Response): Promise<void> => {
  await handleScenarioDelay();
  const scenario = getActiveScenario();
  
  const baseFee = scenario === ScenarioName.INSUFFICIENT_FEE ? '1000000' : '100';

  res.status(200).json({
    last_ledger: '1000',
    last_ledger_base_fee: baseFee,
    ledger_capacity_usage: '0.50',
    fee_charged: { max: baseFee, min: baseFee, mode: baseFee, p10: baseFee, p20: baseFee, p30: baseFee, p40: baseFee, p50: baseFee, p60: baseFee, p70: baseFee, p80: baseFee, p90: baseFee, p95: baseFee, p99: baseFee },
    max_fee: { max: baseFee, min: baseFee, mode: baseFee, p10: baseFee, p20: baseFee, p30: baseFee, p40: baseFee, p50: baseFee, p60: baseFee, p70: baseFee, p80: baseFee, p90: baseFee, p95: baseFee, p99: baseFee },
  });
});

horizonRouter.get('/ledgers/latest', async (req: Request, res: Response): Promise<void> => {
  await handleScenarioDelay();
  res.status(200).json({
    id: 'mock_ledger_hash',
    sequence: 1000,
    closed_at: new Date().toISOString(),
  });
});
