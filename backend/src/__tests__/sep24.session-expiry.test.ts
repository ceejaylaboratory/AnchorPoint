/**
 * SEP-24 interactive session expiry tests for sep24.controller.ts
 * Closes #1184
 */

import { Request, Response } from 'express';
import {
  depositInteractive,
  withdrawInteractive,
  validateInteractiveSession,
  getActiveSession,
  purgeExpiredSessions,
  sep24Sessions,
  SESSION_TTL_MS,
} from '../api/controllers/sep24.controller';

// Suppress logger output in tests - mock the module as Jest resolves it from the test file location
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Mock node-cron so the background cron job doesn't fire during tests
jest.mock('node-cron', () => ({
  schedule: jest.fn(),
  validate: jest.fn().mockReturnValue(true),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown>, params: Record<string, string> = {}): Request {
  return { body, params } as unknown as Request;
}

function makeRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { res, status, json };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('depositInteractive — session creation with expiry', () => {
  beforeEach(() => sep24Sessions.clear());

  it('returns 200 with expires_at ~15 min from now', () => {
    const before = Date.now();
    const { res, json } = makeRes();
    depositInteractive(makeReq({ asset_code: 'USDC', account: 'GABCDE' }), res);

    const response = json.mock.calls[0][0];
    expect(response.expires_at).toBeDefined();

    const expiresAt = new Date(response.expires_at).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + SESSION_TTL_MS - 500);
    expect(expiresAt).toBeLessThanOrEqual(before + SESSION_TTL_MS + 500);
  });

  it('stores the session in the in-memory map', () => {
    const { res, json } = makeRes();
    depositInteractive(makeReq({ asset_code: 'USDC', account: 'GABCDE' }), res);

    const { id } = json.mock.calls[0][0];
    const session = sep24Sessions.get(id);

    expect(session).toBeDefined();
    expect(session!.kind).toBe('deposit');
    expect(session!.assetCode).toBe('USDC');
    expect(session!.account).toBe('GABCDE');
    expect(session!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('returns 400 when asset_code is missing', () => {
    const { res, status, json } = makeRes();
    depositInteractive(makeReq({}), res);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'asset_code is required' }));
  });

  it('returns 400 for unsupported asset', () => {
    const { res, status } = makeRes();
    depositInteractive(makeReq({ asset_code: 'FAKE' }), res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('includes interactive_customer_info_needed type', () => {
    const { res, json } = makeRes();
    depositInteractive(makeReq({ asset_code: 'USDC' }), res);
    expect(json.mock.calls[0][0].type).toBe('interactive_customer_info_needed');
  });
});

describe('withdrawInteractive — session creation with expiry', () => {
  beforeEach(() => sep24Sessions.clear());

  it('returns 200 with expires_at ~15 min from now', () => {
    const before = Date.now();
    const { res, json } = makeRes();
    withdrawInteractive(makeReq({ asset_code: 'USDC', account: 'GABCDE' }), res);

    const response = json.mock.calls[0][0];
    const expiresAt = new Date(response.expires_at).getTime();

    expect(expiresAt).toBeGreaterThanOrEqual(before + SESSION_TTL_MS - 500);
    expect(expiresAt).toBeLessThanOrEqual(before + SESSION_TTL_MS + 500);
  });

  it('stores a withdraw session in the in-memory map', () => {
    const { res, json } = makeRes();
    withdrawInteractive(makeReq({ asset_code: 'BTC', account: 'GBSEP24' }), res);

    const { id } = json.mock.calls[0][0];
    const session = sep24Sessions.get(id);

    expect(session!.kind).toBe('withdraw');
    expect(session!.assetCode).toBe('BTC');
  });

  it('returns 400 when asset_code is missing', () => {
    const { res, status } = makeRes();
    withdrawInteractive(makeReq({}), res);
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('getActiveSession — expiry gating', () => {
  beforeEach(() => sep24Sessions.clear());

  it('returns the session when it has not expired', () => {
    sep24Sessions.set('tx-active', {
      transactionId: 'tx-active',
      assetCode: 'USDC',
      kind: 'deposit',
      expiresAt: Date.now() + 60_000,
    });

    const session = getActiveSession('tx-active');
    expect(session).not.toBeNull();
    expect(session!.transactionId).toBe('tx-active');
  });

  it('returns null and removes the session when it has expired', () => {
    sep24Sessions.set('tx-expired', {
      transactionId: 'tx-expired',
      assetCode: 'USDC',
      kind: 'deposit',
      expiresAt: Date.now() - 1, // expired 1 ms ago
    });

    const session = getActiveSession('tx-expired');
    expect(session).toBeNull();
    expect(sep24Sessions.has('tx-expired')).toBe(false);
  });

  it('returns null for unknown transaction IDs', () => {
    expect(getActiveSession('nonexistent-id')).toBeNull();
  });
});

describe('purgeExpiredSessions — background cleanup', () => {
  beforeEach(() => sep24Sessions.clear());

  it('removes only expired sessions', () => {
    sep24Sessions.set('active', {
      transactionId: 'active',
      assetCode: 'USDC',
      kind: 'deposit',
      expiresAt: Date.now() + 60_000,
    });
    sep24Sessions.set('expired-1', {
      transactionId: 'expired-1',
      assetCode: 'USDC',
      kind: 'deposit',
      expiresAt: Date.now() - 1000,
    });
    sep24Sessions.set('expired-2', {
      transactionId: 'expired-2',
      assetCode: 'BTC',
      kind: 'withdraw',
      expiresAt: Date.now() - 5000,
    });

    const purged = purgeExpiredSessions();

    expect(purged).toBe(2);
    expect(sep24Sessions.has('active')).toBe(true);
    expect(sep24Sessions.has('expired-1')).toBe(false);
    expect(sep24Sessions.has('expired-2')).toBe(false);
  });

  it('returns 0 when no sessions have expired', () => {
    sep24Sessions.set('live', {
      transactionId: 'live',
      assetCode: 'USDC',
      kind: 'deposit',
      expiresAt: Date.now() + 900_000,
    });
    expect(purgeExpiredSessions()).toBe(0);
  });
});

describe('validateInteractiveSession endpoint', () => {
  beforeEach(() => sep24Sessions.clear());

  it('returns 200 with session details for a live session', () => {
    sep24Sessions.set('tx-123', {
      transactionId: 'tx-123',
      assetCode: 'USDC',
      kind: 'deposit',
      expiresAt: Date.now() + 60_000,
    });

    const { res, json } = makeRes();
    validateInteractiveSession(makeReq({}, { id: 'tx-123' }), res);

    const response = json.mock.calls[0][0];
    expect(response.transaction_id).toBe('tx-123');
    expect(response.asset_code).toBe('USDC');
    expect(response.kind).toBe('deposit');
    expect(response.expires_at).toBeDefined();
  });

  it('returns 410 Gone for an expired session', () => {
    sep24Sessions.set('tx-old', {
      transactionId: 'tx-old',
      assetCode: 'USDC',
      kind: 'deposit',
      expiresAt: Date.now() - 1, // expired
    });

    const { res, status, json } = makeRes();
    validateInteractiveSession(makeReq({}, { id: 'tx-old' }), res);

    expect(status).toHaveBeenCalledWith(410);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'session_expired' })
    );
  });

  it('returns 410 for a session ID that was never created', () => {
    const { res, status } = makeRes();
    validateInteractiveSession(makeReq({}, { id: 'ghost-tx' }), res);
    expect(status).toHaveBeenCalledWith(410);
  });

  it('returns 400 when id param is missing', () => {
    const { res, status } = makeRes();
    validateInteractiveSession(makeReq({}, {}), res);
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('SEP-24 session expiry integration: deposit → validateInteractiveSession', () => {
  beforeEach(() => sep24Sessions.clear());

  it('session is valid immediately after deposit request', () => {
    const { res: dRes, json: dJson } = makeRes();
    depositInteractive(makeReq({ asset_code: 'USDC', account: 'GABCDE' }), dRes);
    const { id } = dJson.mock.calls[0][0];

    const { res: vRes, status } = makeRes();
    validateInteractiveSession(makeReq({}, { id }), vRes);

    expect(status).not.toHaveBeenCalledWith(410);
  });

  it('session is rejected after expiry time has passed (mocked)', () => {
    const { res: dRes, json: dJson } = makeRes();
    depositInteractive(makeReq({ asset_code: 'USDC', account: 'GABCDE' }), dRes);
    const { id } = dJson.mock.calls[0][0];

    // Manually expire the session
    const session = sep24Sessions.get(id)!;
    session.expiresAt = Date.now() - 1;

    const { res: vRes, status, json } = makeRes();
    validateInteractiveSession(makeReq({}, { id }), vRes);

    expect(status).toHaveBeenCalledWith(410);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'session_expired' })
    );
  });
});
