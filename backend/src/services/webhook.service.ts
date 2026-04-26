import { createHmac, timingSafeEqual } from 'crypto';
import logger from '../utils/logger';
import { traceAsync, SpanKind } from '../utils/tracing';
import configService from './config.service';

export interface TransactionWebhookRecord {
  id: string;
  userId: string;
  assetCode: string;
  amount: string;
  type: string;
  status: string;
  externalId?: string | null;
  stellarTxId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    publicKey: string;
  } | null;
}

export interface TransactionStatusChangedPayload {
  event: 'transaction.status_changed';
  occurredAt: string;
  previousStatus: string;
  transaction: {
    id: string;
    userId: string;
    userPublicKey?: string;
    assetCode: string;
    amount: string;
    type: string;
    status: string;
    externalId?: string;
    stellarTxId?: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface WebhookConfig {
  url?: string;
  secret?: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface WebhookHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type WebhookHttpClient = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<WebhookHttpResponse>;

export interface WebhookDeliveryResult {
  delivered: boolean;
  attempts: number;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  skipped?: boolean;
}

interface WebhookLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface WebhookServiceDependencies {
  httpClient?: WebhookHttpClient;
  sleep?: (ms: number) => Promise<void>;
  logger?: WebhookLogger;
}

export interface TransactionStatusUpdateDependencies {
  transaction: {
    findUnique(args: Record<string, unknown>): Promise<TransactionWebhookRecord | null>;
    update(args: Record<string, unknown>): Promise<TransactionWebhookRecord>;
  };
}

export interface UpdateTransactionStatusInput {
  prisma: TransactionStatusUpdateDependencies;
  transactionId: string;
  nextStatus: string;
  webhookService?: WebhookService;
}

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const defaultHttpClient: WebhookHttpClient = async (url, init) => {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
};

export const loadWebhookConfigFromEnv = (): WebhookConfig => {
  const cfg = configService.getConfig();
  return {
    url: cfg.WEBHOOK_URL,
    secret: cfg.WEBHOOK_SECRET,
    timeoutMs: cfg.WEBHOOK_TIMEOUT_MS,
    maxRetries: cfg.WEBHOOK_MAX_RETRIES,
    retryDelayMs: cfg.WEBHOOK_RETRY_DELAY_MS,
  };
};

export const buildTransactionStatusChangedPayload = (
  transaction: TransactionWebhookRecord,
  previousStatus: string
): TransactionStatusChangedPayload => ({
  event: 'transaction.status_changed',
  occurredAt: new Date().toISOString(),
  previousStatus,
  transaction: {
    id: transaction.id,
    userId: transaction.userId,
    ...(transaction.user?.publicKey ? { userPublicKey: transaction.user.publicKey } : {}),
    assetCode: transaction.assetCode,
    amount: transaction.amount,
    type: transaction.type,
    status: transaction.status,
    ...(transaction.externalId ? { externalId: transaction.externalId } : {}),
    ...(transaction.stellarTxId ? { stellarTxId: transaction.stellarTxId } : {}),
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  },
});

export const signWebhookPayload = (payload: string, secret: string, timestamp: string): string => {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  return `sha256=${digest}`;
};

export const verifyWebhookSignature = (
  payload: string,
  secret: string,
  timestamp: string,
  providedSignature: string
): boolean => {
  const expectedSignature = signWebhookPayload(payload, secret, timestamp);
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
};

export class WebhookService {
  private readonly httpClient: WebhookHttpClient;

  private readonly sleepFn: (ms: number) => Promise<void>;

  private readonly log: WebhookLogger;

  private readonly injectedConfig?: WebhookConfig;

  constructor(
    injectedConfig?: WebhookConfig,
    dependencies: WebhookServiceDependencies = {}
  ) {
    this.injectedConfig = injectedConfig;
    this.httpClient = dependencies.httpClient ?? defaultHttpClient;
    this.sleepFn = dependencies.sleep ?? sleep;
    this.log = dependencies.logger ?? logger;
  }

  private getConfig(): WebhookConfig {
    if (this.injectedConfig) {
      return this.injectedConfig;
    }
    const cfg = configService.getConfig();
    return {
      url: cfg.WEBHOOK_URL,
      secret: cfg.WEBHOOK_SECRET,
      timeoutMs: cfg.WEBHOOK_TIMEOUT_MS,
      maxRetries: cfg.WEBHOOK_MAX_RETRIES,
      retryDelayMs: cfg.WEBHOOK_RETRY_DELAY_MS,
    };
  }

  isEnabled(): boolean {
    const config = this.getConfig();
    return Boolean(config.url && config.secret);
  }

  async sendTransactionStatusChanged(
    transaction: TransactionWebhookRecord,
    previousStatus: string
  ): Promise<WebhookDeliveryResult> {
    if (transaction.status === previousStatus) {
      return {
        delivered: false,
        attempts: 0,
        skipped: true,
      };
    }

    if (!this.isEnabled()) {
      this.log.info('Skipping webhook delivery because webhook configuration is incomplete', {
        transactionId: transaction.id,
      });
      return {
        delivered: false,
        attempts: 0,
        skipped: true,
      };
    }

    const payload = buildTransactionStatusChangedPayload(transaction, previousStatus);
    return this.deliver(payload, transaction.id);
  }

  private async deliver(
    payload: TransactionStatusChangedPayload,
    transactionId: string
  ): Promise<WebhookDeliveryResult> {
    const config = this.getConfig();
    return traceAsync(
      'webhook.deliver',
      async (span) => {
        span.setAttribute('webhook.transaction_id', transactionId);
        span.setAttribute('webhook.event_type', payload.event);

        const requestBody = JSON.stringify(payload);
        let lastStatusCode: number | undefined;
        let lastResponseBody: string | undefined;
        let lastError: unknown;

        for (let attempt = 1; attempt <= config.maxRetries + 1; attempt += 1) {
          const timestamp = new Date().toISOString();
          const signature = signWebhookPayload(requestBody, config.secret!, timestamp);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

          try {
            const response = await this.httpClient(config.url!, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-anchorpoint-event': payload.event,
                'x-anchorpoint-signature': signature,
                'x-anchorpoint-timestamp': timestamp,
                'x-anchorpoint-delivery-attempt': String(attempt),
              },
              body: requestBody,
              signal: controller.signal,
            });

            clearTimeout(timeout);
            lastStatusCode = response.status;
            lastResponseBody = await response.text();

            if (response.ok) {
              this.log.info('Webhook delivered successfully', {
                transactionId,
                attempts: attempt,
                statusCode: response.status,
              });
              return {
                delivered: true,
                attempts: attempt,
                statusCode: response.status,
                responseBody: lastResponseBody,
              };
            }

            if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt > config.maxRetries) {
              this.log.warn('Webhook delivery failed without further retries', {
                transactionId,
                attempts: attempt,
                statusCode: response.status,
              });
              return {
                delivered: false,
                attempts: attempt,
                statusCode: response.status,
                responseBody: lastResponseBody,
                error: `Webhook responded with status ${response.status}`,
              };
            }
          } catch (error) {
            clearTimeout(timeout);
            lastError = error;

            if (attempt > config.maxRetries) {
              this.log.error('Webhook delivery exhausted retries after request error', {
                transactionId,
                attempts: attempt,
                error: error instanceof Error ? error.message : String(error),
              });
              return {
                delivered: false,
                attempts: attempt,
                statusCode: lastStatusCode,
                responseBody: lastResponseBody,
                error: error instanceof Error ? error.message : 'Unknown webhook error',
              };
            }
          }

          await this.sleepFn(this.getRetryDelay(attempt));
        }

        return {
          delivered: false,
          attempts: config.maxRetries + 1,
          statusCode: lastStatusCode,
          responseBody: lastResponseBody,
          error: lastError instanceof Error ? lastError.message : 'Webhook delivery failed',
        };
      },
      SpanKind.CLIENT,
      {
        'webhook.url': config.url ?? '',
        'webhook.max_retries': config.maxRetries,
      }
    );
  }

  private getRetryDelay(attempt: number): number {
    const config = this.getConfig();
    return config.retryDelayMs * 2 ** (attempt - 1);
  }
}

export const defaultWebhookService = new WebhookService();

export const updateTransactionStatusAndNotify = async ({
  prisma,
  transactionId,
  nextStatus,
  webhookService = defaultWebhookService,
}: UpdateTransactionStatusInput): Promise<{
  transaction: TransactionWebhookRecord;
  webhookDelivery: WebhookDeliveryResult;
}> => {
  return traceAsync(
    'transaction.update_status_and_notify',
    async (span) => {
      span.setAttribute('transaction.id', transactionId);
      span.setAttribute('transaction.next_status', nextStatus);
      
      const existingTransaction = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      user: {
        select: {
          publicKey: true,
        },
      },
    },
  });

  if (!existingTransaction) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  if (existingTransaction.status === nextStatus) {
    return {
      transaction: existingTransaction,
      webhookDelivery: {
        delivered: false,
        attempts: 0,
        skipped: true,
      },
    };
  }

  const updatedTransaction = await prisma.transaction.update({
    where: { id: transactionId },
    data: { status: nextStatus },
    include: {
      user: {
        select: {
          publicKey: true,
        },
      },
    },
  });

  try {
    const webhookDelivery = await webhookService.sendTransactionStatusChanged(
      updatedTransaction,
      existingTransaction.status
    );

    return {
      transaction: updatedTransaction,
      webhookDelivery,
    };
  } catch (error) {
    logger.error('Transaction status updated but webhook delivery threw unexpectedly', {
      transactionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
        transaction: updatedTransaction,
        webhookDelivery: {
          delivered: false,
          attempts: 1,
          error: error instanceof Error ? error.message : 'Unknown webhook error',
        },
      };
    }
  },
  SpanKind.INTERNAL,
  {
    'transaction.operation': 'update_status_and_notify',
  }
  );
};

export default defaultWebhookService;
