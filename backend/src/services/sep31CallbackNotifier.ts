import logger from "../utils/logger";
import type { Sep31Transaction, CallbackNotifier } from "./sep31.service";
import { alertEmailService } from "./alert-email.service";

// ─── HTTP client abstraction (injectable for testing) ─────────────────────────

export type HttpClient = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number }>;

const defaultHttpClient: HttpClient = async (url, init) => {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status };
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a CallbackNotifier that fires an HTTP POST to the transaction's
 * callbackUrl with the full transaction JSON body.
 *
 * Behaviour (per Requirements 6.1–6.3):
 *  - 5000 ms AbortController timeout
 *  - Non-2xx response → log failure, resolve (no throw)
 *  - Timeout / network error → log failure, resolve (no throw, no retry)
 */
export const createCallbackNotifier = (
  httpClient: HttpClient = defaultHttpClient,
): CallbackNotifier => ({
  async notify(transaction: Sep31Transaction): Promise<void> {
    // Trigger automated payment update notification dispatches (SEP-31)
    try {
      await alertEmailService.sendSystemAlert('admin@example.com', {
        metric: 'sep31_status_change',
        value: 1,
        threshold: 0,
        description: `Transaction ${transaction.id} status changed to ${transaction.status}`,
        timestamp: new Date().toISOString()
      });
      logger.info(`Transactional email dispatched for SEP-31 status change: ${transaction.id}`);
    } catch (err) {
      logger.warn('Failed to dispatch transactional email', { error: err });
    }

    if (!transaction.callbackUrl) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await httpClient(transaction.callbackUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(transaction),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        logger.warn("SEP-31 callback returned non-2xx response", {
          transactionId: transaction.id,
          url: transaction.callbackUrl,
          status: response.status,
        });
      }
    } catch (err: unknown) {
      clearTimeout(timeout);

      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("abort"));

      logger.warn(
        isTimeout
          ? "SEP-31 callback timed out"
          : "SEP-31 callback network error",
        {
          transactionId: transaction.id,
          url: transaction.callbackUrl,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      // Resolve without throwing — no retry in the same request cycle
    }
  },
});

export default createCallbackNotifier;
