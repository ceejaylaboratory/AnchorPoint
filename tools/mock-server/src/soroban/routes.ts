// IMPLEMENTATION APPROACH: Option A — Node.js/TypeScript + Express
// Rationale: Simplifies handling the JSON-RPC 2.0 batch/multiplexing specification required by Soroban.

import { Router, Request, Response } from 'express';
import { getActiveScenario, ScenarioName, handleScenarioDelay } from '../scenarios';
import { getLedgerEntry } from '../ledger-state';

export const sorobanRouter = Router();

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

const sendJsonRpcResult = (res: Response, id: string | number, result: any): void => {
  res.status(200).json({ jsonrpc: '2.0', id, result });
};

const sendJsonRpcError = (res: Response, id: string | number, code: number, message: string): void => {
  res.status(200).json({ jsonrpc: '2.0', id, error: { code, message } });
};

sorobanRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  await handleScenarioDelay();
  const { jsonrpc, id, method, params } = req.body as JsonRpcRequest;

  if (jsonrpc !== '2.0') {
    res.status(400).send('Invalid JSON-RPC version');
    return;
  }

  const scenario = getActiveScenario();

  switch (method) {
    case 'simulateTransaction':
      if (scenario === ScenarioName.TRANSACTION_FAILED) {
        sendJsonRpcResult(res, id, { error: 'Simulation failed: mock error' });
      } else {
        sendJsonRpcResult(res, id, {
          transactionData: 'mock_transaction_data_xdr',
          minResourceFee: '100',
          cost: { cpuInsns: '1000', memBytes: '1000' },
          results: [{ auth: [], xdr: 'mock_result_xdr' }],
          latestLedger: 1000,
        });
      }
      break;

    case 'sendTransaction':
      if (scenario === ScenarioName.TRANSACTION_FAILED) {
        sendJsonRpcResult(res, id, { status: 'ERROR', hash: 'mock_hash', errorResultXdr: 'error_xdr' });
      } else {
        sendJsonRpcResult(res, id, { status: 'PENDING', hash: 'mock_hash', latestLedger: 1000 });
      }
      break;

    case 'getTransaction':
      if (scenario === ScenarioName.TRANSACTION_FAILED) {
        sendJsonRpcResult(res, id, { status: 'FAILED', resultXdr: 'error_xdr' });
      } else {
        sendJsonRpcResult(res, id, { status: 'SUCCESS', resultXdr: 'success_xdr', ledger: 1000, createdAt: 1670000000 });
      }
      break;

    case 'getLedgerEntries':
      if (scenario === ScenarioName.LEDGER_ENTRY_MISSING) {
        sendJsonRpcResult(res, id, { entries: [], latestLedger: 1000 });
      } else {
        const keys: string[] = params;
        const entries = keys.map((key) => {
          const entry = getLedgerEntry(key);
          return entry ? { key, xdr: entry, lastModifiedLedgerSeq: 1000 } : null;
        }).filter(Boolean);
        sendJsonRpcResult(res, id, { entries, latestLedger: 1000 });
      }
      break;

    case 'getLatestLedger':
      sendJsonRpcResult(res, id, { id: 'mock_hash', protocolVersion: 20, sequence: 1000 });
      break;

    default:
      sendJsonRpcError(res, id, -32601, `Method '${method}' not found`);
  }
});
