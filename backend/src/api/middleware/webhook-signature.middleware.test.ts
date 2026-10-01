/**
 * Unit tests for webhook-signature.middleware.ts
 *
 * Covers:
 *  - Single-secret verification (happy path)
 *  - Dual-secret rotation (primary + secondary)
 *  - Signature computed with secondary secret is accepted
 *  - Invalid signature → 401
 *  - Missing headers → 401
 *  - Stale timestamp → 401
 *  - computeWebhookSignature helper
 *  - verifyWebhookSignatureMultiSecret helper
 */

import { Request, Response } from 'express';
import {
  computeWebhookSignature,
  verifyWebhookSignatureMultiSecret,
  webhookSignatureMiddleware,
  WebhookSignatureOptions,
} from './webhook-signature.middleware';

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

function makeMockReq(
  overrides: Partial<{
    headers: Record<string, string>;
    body: unknown;
    rawBody: string;
    path: string;
  }> = {}
): Request {
  return {
    headers: {},
    body: {},
    path: '/webhook',
    ...overrides,
  } as unknown as Request;
}

function makeMockRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

// ─── computeWebhookSignature ────────────────────────────────────────────────

describe('computeWebhookSignature', () => {
  it('returns sha256=<hex> format', () => {
    const sig = computeWebhookSignature('{"foo":"bar"}', 'secret', '1234567890');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = computeWebhookSignature('payload', 'secret', 'ts');
    const b = computeWebhookSignature('payload', 'secret', 'ts');
    expect(a).toBe(b);
  });

  it('differs when the secret changes', () => {
    const a = computeWebhookSignature('payload', 'secret1', 'ts');
    const b = computeWebhookSignature('payload', 'secret2', 'ts');
    expect(a).not.toBe(b);
  });

  it('differs when the timestamp changes', () => {
    const a = computeWebhookSignature('payload', 'secret', '100');
    const b = computeWebhookSignature('payload', 'secret', '200');
    expect(a).not.toBe(b);
  });
});

// ─── verifyWebhookSignatureMultiSecret ─────────────────────────────────────

describe('verifyWebhookSignatureMultiSecret', () => {
  const payload = '{"event":"test"}';
  const ts = '1700000000';
  const primary = 'primary-secret';
  const secondary = 'secondary-secret';

  it('returns true when signature matches primary secret', () => {
    const sig = computeWebhookSignature(payload, primary, ts);
    expect(verifyWebhookSignatureMultiSecret(payload, [primary], ts, sig)).toBe(true);
  });

  it('returns true when signature matches secondary secret only', () => {
    const sig = computeWebhookSignature(payload, secondary, ts);
    expect(verifyWebhookSignatureMultiSecret(payload, [primary, secondary], ts, sig)).toBe(true);
  });

  it('returns false when signature matches neither secret', () => {
    const sig = computeWebhookSignature(payload, 'unrelated-secret', ts);
    expect(verifyWebhookSignatureMultiSecret(payload, [primary, secondary], ts, sig)).toBe(false);
  });

  it('returns false for an empty secrets array', () => {
    const sig = computeWebhookSignature(payload, primary, ts);
    expect(verifyWebhookSignatureMultiSecret(payload, [], ts, sig)).toBe(false);
  });

  it('returns false for tampered payload', () => {
    const sig = computeWebhookSignature(payload, primary, ts);
    expect(
      verifyWebhookSignatureMultiSecret('{"event":"tampered"}', [primary], ts, sig)
    ).toBe(false);
  });
});

// ─── webhookSignatureMiddleware ─────────────────────────────────────────────

describe('webhookSignatureMiddleware', () => {
  const secret = 'test-secret';
  const payload = '{"hello":"world"}';
  const ts = nowSeconds();

  function buildReq(sigOverride?: string, tsOverride?: string, rawBody?: string) {
    const sig = sigOverride ?? computeWebhookSignature(payload, secret, ts);
    return makeMockReq({
      headers: {
        'x-webhook-signature': sig,
        'x-webhook-timestamp': tsOverride ?? ts,
      },
      body: JSON.parse(payload),
      rawBody: rawBody ?? payload,
    });
  }

  it('calls next() when signature is valid (single secret)', () => {
    const middleware = webhookSignatureMiddleware({ secrets: secret });
    const req = buildReq();
    const { res } = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when signature matches secondary secret during rotation', () => {
    const secondary = 'new-secret';
    const middleware = webhookSignatureMiddleware({ secrets: [secondary, secret] });
    // Old sender still signs with `secret`
    const req = buildReq(computeWebhookSignature(payload, secret, ts));
    const { res } = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() when signature matches primary secret in dual-secret array', () => {
    const primary = 'primary-secret';
    const middleware = webhookSignatureMiddleware({ secrets: [primary, secret] });
    const req = buildReq(computeWebhookSignature(payload, primary, ts));
    const { res } = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 401 missing_signature when header absent', () => {
    const middleware = webhookSignatureMiddleware({ secrets: secret });
    const req = makeMockReq({
      headers: { 'x-webhook-timestamp': ts },
      rawBody: payload,
    });
    const { res, status, json } = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'missing_signature' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 missing_timestamp when header absent', () => {
    const middleware = webhookSignatureMiddleware({ secrets: secret });
    const req = makeMockReq({
      headers: { 'x-webhook-signature': 'sha256=abc' },
      rawBody: payload,
    });
    const { res, status, json } = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'missing_timestamp' });
  });

  it('returns 401 timestamp_too_old for a stale timestamp', () => {
    const middleware = webhookSignatureMiddleware({ secrets: secret, maxAgeSeconds: 60 });
    const staleTs = String(Math.floor(Date.now() / 1000) - 120); // 2 min ago
    const sig = computeWebhookSignature(payload, secret, staleTs);
    const req = buildReq(sig, staleTs);
    const { res, status, json } = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'timestamp_too_old' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 invalid_signature for a wrong signature', () => {
    const middleware = webhookSignatureMiddleware({ secrets: secret });
    const req = buildReq('sha256=deadbeef00000000000000000000000000000000000000000000000000000000');
    const { res, status, json } = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'invalid_signature' });
  });

  it('returns 401 invalid_timestamp for a non-numeric timestamp', () => {
    const middleware = webhookSignatureMiddleware({ secrets: secret });
    const req = buildReq(undefined, 'not-a-number');
    const { res, status, json } = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'invalid_timestamp' });
  });

  it('throws when no valid secrets provided', () => {
    expect(() => webhookSignatureMiddleware({ secrets: [] })).toThrow(
      'at least one non-empty secret',
    );
  });

  it('accepts custom header names', () => {
    const middleware = webhookSignatureMiddleware({
      secrets: secret,
      signatureHeader: 'x-hub-signature-256',
      timestampHeader: 'x-hub-timestamp',
    });
    const sig = computeWebhookSignature(payload, secret, ts);
    const req = makeMockReq({
      headers: {
        'x-hub-signature-256': sig,
        'x-hub-timestamp': ts,
      },
      rawBody: payload,
    });
    const { res } = makeMockRes();
    const next = jest.fn();
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
