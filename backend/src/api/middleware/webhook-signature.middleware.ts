/**
 * Webhook Signature Middleware — Multi-Secret Rotation Support
 *
 * Validates incoming webhook requests against one or more HMAC-SHA256 secrets.
 * Supports zero-downtime key rotation by accepting an ordered array of secrets
 * [WEBHOOK_SECRET_PRIMARY, WEBHOOK_SECRET_SECONDARY, ...]. A request is
 * authenticated if its signature matches *any* active secret.
 *
 * Signature format (same as the outbound signing in webhook.service.ts):
 *   X-Webhook-Signature: sha256=<hex>
 *   X-Webhook-Timestamp: <unix-seconds>
 *
 * The HMAC digest is computed over `${timestamp}.${rawBody}`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import logger from '../../utils/logger';

export interface WebhookSignatureOptions {
  /**
   * Ordered list of active HMAC secrets.  The first entry should be the
   * current (primary) secret; subsequent entries are kept alive during a
   * rotation window so that in-flight requests signed with the old key are
   * still accepted.
   *
   * When a single string is provided it is wrapped in an array automatically.
   */
  secrets: string | string[];

  /**
   * Maximum allowed age (in seconds) between the request timestamp and the
   * current wall-clock time.  Defaults to 300 s (5 min) to guard against
   * replay attacks.
   */
  maxAgeSeconds?: number;

  /**
   * Header that carries the HMAC digest.
   * Defaults to `x-webhook-signature`.
   */
  signatureHeader?: string;

  /**
   * Header that carries the Unix timestamp used in digest computation.
   * Defaults to `x-webhook-timestamp`.
   */
  timestampHeader?: string;
}

const DEFAULT_MAX_AGE_SECONDS = 300;
const DEFAULT_SIGNATURE_HEADER = 'x-webhook-signature';
const DEFAULT_TIMESTAMP_HEADER = 'x-webhook-timestamp';

/**
 * Computes the expected HMAC-SHA256 signature for a given payload / secret.
 *
 * Exported so it can be reused in tests and the outbound webhook service.
 */
export function computeWebhookSignature(
  payload: string,
  secret: string,
  timestamp: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `sha256=${digest}`;
}

/**
 * Constant-time comparison of two signature strings.
 * Returns false when the lengths differ to avoid length-oracle attacks.
 */
function signaturesMatch(expected: string, provided: string): boolean {
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verifies a webhook payload against an array of secrets.
 *
 * @returns `true` if the signature matches at least one secret.
 */
export function verifyWebhookSignatureMultiSecret(
  payload: string,
  secrets: string[],
  timestamp: string,
  providedSignature: string,
): boolean {
  for (const secret of secrets) {
    const expected = computeWebhookSignature(payload, secret, timestamp);
    if (signaturesMatch(expected, providedSignature)) {
      return true;
    }
  }
  return false;
}

/**
 * Express middleware factory.
 *
 * Usage:
 * ```ts
 * const secrets = [process.env.WEBHOOK_SECRET_PRIMARY!, process.env.WEBHOOK_SECRET_SECONDARY].filter(Boolean);
 * router.post('/webhook', webhookSignatureMiddleware({ secrets }), handler);
 * ```
 */
export function webhookSignatureMiddleware(options: WebhookSignatureOptions) {
  const secrets: string[] = Array.isArray(options.secrets)
    ? options.secrets
    : [options.secrets];

  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  const sigHeader = (options.signatureHeader ?? DEFAULT_SIGNATURE_HEADER).toLowerCase();
  const tsHeader = (options.timestampHeader ?? DEFAULT_TIMESTAMP_HEADER).toLowerCase();

  if (secrets.length === 0 || secrets.every((s) => !s)) {
    throw new Error(
      'webhookSignatureMiddleware: at least one non-empty secret must be provided',
    );
  }

  const activeSecrets = secrets.filter(Boolean);

  return function verifyWebhookRequest(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const providedSignature = req.headers[sigHeader] as string | undefined;
    const timestampHeader = req.headers[tsHeader] as string | undefined;

    if (!providedSignature) {
      logger.warn('Webhook request missing signature header', {
        header: sigHeader,
        path: req.path,
      });
      res.status(401).json({ error: 'missing_signature' });
      return;
    }

    if (!timestampHeader) {
      logger.warn('Webhook request missing timestamp header', {
        header: tsHeader,
        path: req.path,
      });
      res.status(401).json({ error: 'missing_timestamp' });
      return;
    }

    // Replay-attack guard: reject stale timestamps
    const requestTs = parseInt(timestampHeader, 10);
    if (isNaN(requestTs)) {
      res.status(401).json({ error: 'invalid_timestamp' });
      return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - requestTs) > maxAgeSeconds) {
      logger.warn('Webhook request timestamp outside acceptable window', {
        requestTs,
        nowSeconds,
        maxAgeSeconds,
        path: req.path,
      });
      res.status(401).json({ error: 'timestamp_too_old' });
      return;
    }

    // Raw body is required for signature verification.
    // Express raw-body middleware (or `express.json({ verify: ... })`) must
    // have populated `req.rawBody` before this middleware runs.
    const rawBody: string =
      (req as Request & { rawBody?: string }).rawBody ??
      (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? ''));

    const valid = verifyWebhookSignatureMultiSecret(
      rawBody,
      activeSecrets,
      timestampHeader,
      providedSignature,
    );

    if (!valid) {
      logger.warn('Webhook signature verification failed', {
        path: req.path,
        secretsChecked: activeSecrets.length,
      });
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    next();
  };
}

export default webhookSignatureMiddleware;
