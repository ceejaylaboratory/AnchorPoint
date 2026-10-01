import {
  buildKycStatusChangedPayload,
  buildTransactionStatusChangedPayload,
  calculateExponentialBackoff,
  signWebhookPayload,
  updateTransactionStatusAndNotify,
  verifyWebhookSignature,
  WebhookService,
  type KycWebhookRecord,
  type TransactionWebhookRecord,
} from './webhook.service';
import { InMemoryWebhookDeliveryStore } from './idempotentWebhook.service';

const baseTransaction: TransactionWebhookRecord = {
  id: 'txn_123',
  userId: 'user_123',
  assetCode: 'USDC',
  amount: '25.00',
  type: 'DEPOSIT',
  status: 'COMPLETED',
  externalId: 'ext_123',
  stellarTxId: 'stellar_123',
  createdAt: new Date('2026-03-30T10:00:00.000Z'),
  updatedAt: new Date('2026-03-30T10:05:00.000Z'),
  user: {
    publicKey: 'GBPUBLICKEY123',
  },
};

const baseKycCustomer: KycWebhookRecord = {
  id: 'kyc_123',
  userId: 'user_123',
  provider: 'mock',
  providerRef: 'mock_123',
  status: 'ACCEPTED',
  createdAt: new Date('2026-03-30T10:00:00.000Z'),
  updatedAt: new Date('2026-03-30T10:05:00.000Z'),
  user: {
    publicKey: 'GBPUBLICKEY123',
  },
};

const makeService = (
  httpClient: jest.Mock,
  extras: {
    sleep?: jest.Mock;
    deliveryStore?: InMemoryWebhookDeliveryStore;
    enqueueRetry?: jest.Mock;
    maxRetries?: number;
  } = {}
) =>
  new WebhookService(
    {
      url: 'https://example.com/webhooks',
      secret: 'super-secret',
      timeoutMs: 1000,
      maxRetries: extras.maxRetries ?? 2,
      retryDelayMs: 50,
    },
    {
      httpClient,
      sleep: extras.sleep ?? jest.fn().mockResolvedValue(undefined),
      deliveryStore: extras.deliveryStore ?? new InMemoryWebhookDeliveryStore(),
      enqueueRetry: extras.enqueueRetry ?? jest.fn().mockResolvedValue(null),
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }
  );

describe('Webhook Service', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('builds a transaction status changed payload with normalized timestamps', () => {
    const payload = buildTransactionStatusChangedPayload(baseTransaction, 'PENDING');

    expect(payload).toEqual({
      event: 'transaction.status_changed',
      occurredAt: expect.any(String),
      previousStatus: 'PENDING',
      transaction: {
        id: 'txn_123',
        userId: 'user_123',
        userPublicKey: 'GBPUBLICKEY123',
        assetCode: 'USDC',
        amount: '25.00',
        type: 'DEPOSIT',
        status: 'COMPLETED',
        externalId: 'ext_123',
        stellarTxId: 'stellar_123',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:05:00.000Z',
      },
    });
  });

  it('builds a customer KYC status updated payload with provider identifiers', () => {
    const payload = buildKycStatusChangedPayload(baseKycCustomer, 'PENDING');

    expect(payload).toEqual({
      event: 'customer.kyc_status_updated',
      occurredAt: expect.any(String),
      previousStatus: 'PENDING',
      customer: {
        id: 'kyc_123',
        userId: 'user_123',
        account: 'GBPUBLICKEY123',
        provider: 'mock',
        providerRef: 'mock_123',
        status: 'ACCEPTED',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:05:00.000Z',
      },
    });
  });

  it('includes rejection reason codes in webhook payload when status is REJECTED', () => {
    const rejectedCustomer: KycWebhookRecord = {
      ...baseKycCustomer,
      status: 'REJECTED',
      rejectionReasons: ['ID_DOCUMENT_EXPIRED', 'ADDRESS_MISMATCH'],
    };

    const payload = buildKycStatusChangedPayload(rejectedCustomer, 'PENDING');

    expect(payload).toEqual({
      event: 'customer.kyc_status_updated',
      occurredAt: expect.any(String),
      previousStatus: 'PENDING',
      customer: {
        id: 'kyc_123',
        userId: 'user_123',
        account: 'GBPUBLICKEY123',
        provider: 'mock',
        providerRef: 'mock_123',
        status: 'REJECTED',
        rejectionReasons: ['ID_DOCUMENT_EXPIRED', 'ADDRESS_MISMATCH'],
        rejectionReasonCodes: ['ID_DOCUMENT_EXPIRED', 'ADDRESS_MISMATCH'],
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:05:00.000Z',
      },
    });
  });

  it('signs and verifies webhook payloads with the shared secret', () => {
    const payload = JSON.stringify({ hello: 'world' });
    const timestamp = '2026-03-30T11:00:00.000Z';
    const signature = signWebhookPayload(payload, 'super-secret', timestamp);

    expect(signature.startsWith('sha256=')).toBe(true);
    expect(verifyWebhookSignature(payload, 'super-secret', timestamp, signature)).toBe(true);
    expect(verifyWebhookSignature(payload, 'wrong-secret', timestamp, signature)).toBe(false);
  });

  it('retries transient failures and succeeds on a later attempt', async () => {
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    const httpClient = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'temporary outage',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok',
      });

    const service = makeService(httpClient, { sleep: sleepFn });

    const result = await service.sendTransactionStatusChanged(baseTransaction, 'PENDING');

    expect(result).toEqual({
      delivered: true,
      attempts: 2,
      statusCode: 200,
      responseBody: 'ok',
    });
    expect(httpClient).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(50);

    const [, request] = httpClient.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(request.headers['x-anchorpoint-event']).toBe('transaction.status_changed');
    expect(request.headers['Idempotency-Key']).toBe('sep24:txn_123:PENDING->COMPLETED');
    expect(request.headers['x-anchorpoint-signature']).toMatch(/^sha256=/);
    expect(
      verifyWebhookSignature(
        request.body,
        'super-secret',
        request.headers['x-anchorpoint-timestamp'],
        request.headers['x-anchorpoint-signature']
      )
    ).toBe(true);
  });

  it('sends signed customer.kyc_status_updated webhook events with rejection reasons', async () => {
    const httpClient = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });

    const service = makeService(httpClient);
    const rejectedCustomer: KycWebhookRecord = {
      ...baseKycCustomer,
      status: 'REJECTED',
    };

    const result = await service.sendKycStatusChanged(
      rejectedCustomer,
      'PENDING',
      ['SANCTIONS_HIT']
    );

    expect(result).toEqual({
      delivered: true,
      attempts: 1,
      statusCode: 200,
      responseBody: 'ok',
    });
    expect(httpClient).toHaveBeenCalledTimes(1);

    const [, request] = httpClient.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(request.headers['x-anchorpoint-event']).toBe('customer.kyc_status_updated');
    expect(request.headers['Idempotency-Key']).toBe('sep12:kyc_123:PENDING->REJECTED');
    expect(request.body).toContain('"event":"customer.kyc_status_updated"');
    expect(request.body).toContain('"rejectionReasons":["SANCTIONS_HIT"]');
    expect(
      verifyWebhookSignature(
        request.body,
        'super-secret',
        request.headers['x-anchorpoint-timestamp'],
        request.headers['x-anchorpoint-signature']
      )
    ).toBe(true);
  });

  it('does not retry permanent client errors', async () => {
    const httpClient = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    });
    const enqueueRetry = jest.fn().mockResolvedValue('job-1');

    const service = makeService(httpClient, { enqueueRetry, maxRetries: 3 });

    const result = await service.sendTransactionStatusChanged(baseTransaction, 'PENDING');

    expect(result).toEqual({
      delivered: false,
      attempts: 1,
      statusCode: 400,
      responseBody: 'bad request',
      error: 'Webhook responded with status 400',
    });
    expect(httpClient).toHaveBeenCalledTimes(1);
    expect(enqueueRetry).toHaveBeenCalled();
  });

  it('skips delivery when the status did not change', async () => {
    const service = makeService(jest.fn());

    await expect(service.sendTransactionStatusChanged(baseTransaction, 'COMPLETED')).resolves.toEqual({
      delivered: false,
      attempts: 0,
      skipped: true,
    });
    await expect(service.sendKycStatusChanged(baseKycCustomer, 'ACCEPTED')).resolves.toEqual({
      delivered: false,
      attempts: 0,
      skipped: true,
    });
  });

  it('prevents duplicate webhook emissions for identical status transitions via Redis hash store', async () => {
    const httpClient = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });
    const deliveryStore = new InMemoryWebhookDeliveryStore();
    const service = makeService(httpClient, { deliveryStore });

    await service.sendTransactionStatusChanged(baseTransaction, 'PENDING');
    const second = await service.sendTransactionStatusChanged(baseTransaction, 'PENDING');

    expect(second).toEqual({
      delivered: false,
      attempts: 0,
      skipped: true,
    });
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  it('updates a transaction and notifies through the webhook service', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...baseTransaction,
      status: 'PENDING',
    });
    const update = jest.fn().mockResolvedValue(baseTransaction);
    const sendTransactionStatusChanged = jest.fn().mockResolvedValue({
      delivered: true,
      attempts: 1,
      statusCode: 200,
      responseBody: 'ok',
    });

    const result = await updateTransactionStatusAndNotify({
      prisma: {
        transaction: {
          findUnique,
          update,
        },
      },
      transactionId: 'txn_123',
      nextStatus: 'COMPLETED',
      webhookService: {
        sendTransactionStatusChanged,
      } as unknown as WebhookService,
    });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn_123' },
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn_123' },
        data: { status: 'COMPLETED' },
      })
    );
    expect(sendTransactionStatusChanged).toHaveBeenCalledWith(baseTransaction, 'PENDING');
    expect(result).toEqual({
      transaction: baseTransaction,
      webhookDelivery: {
        delivered: true,
        attempts: 1,
        statusCode: 200,
        responseBody: 'ok',
      },
    });
  });

  it('returns early when updateTransactionStatusAndNotify receives the same status', async () => {
    const findUnique = jest.fn().mockResolvedValue(baseTransaction);
    const update = jest.fn();

    const result = await updateTransactionStatusAndNotify({
      prisma: {
        transaction: {
          findUnique,
          update,
        },
      },
      transactionId: 'txn_123',
      nextStatus: 'COMPLETED',
      webhookService: {
        sendTransactionStatusChanged: jest.fn(),
      } as unknown as WebhookService,
    });

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      transaction: baseTransaction,
      webhookDelivery: {
        delivered: false,
        attempts: 0,
        skipped: true,
      },
    });
  });

  it('calculates exponential backoff delays (2s, 4s, 8s, 16s, 32s)', () => {
    expect(calculateExponentialBackoff(1, 2000)).toBe(2000);
    expect(calculateExponentialBackoff(2, 2000)).toBe(4000);
    expect(calculateExponentialBackoff(3, 2000)).toBe(8000);
    expect(calculateExponentialBackoff(4, 2000)).toBe(16000);
    expect(calculateExponentialBackoff(5, 2000)).toBe(32000);
  });

  it('retries up to maxRetries on HTTP 500 errors with exponential backoff sequence', async () => {
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    const httpClient = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });
    const enqueueRetry = jest.fn().mockResolvedValue('retry-job-id');

    const service = makeService(httpClient, { sleep: sleepFn, enqueueRetry, maxRetries: 5 });

    const result = await service.sendKycStatusChanged(baseKycCustomer, 'PENDING');

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(6);
    expect(httpClient).toHaveBeenCalledTimes(6);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 2000);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 4000);
    expect(sleepFn).toHaveBeenNthCalledWith(3, 8000);
    expect(sleepFn).toHaveBeenNthCalledWith(4, 16000);
    expect(sleepFn).toHaveBeenNthCalledWith(5, 32000);
    expect(enqueueRetry).toHaveBeenCalled();
  });
});
