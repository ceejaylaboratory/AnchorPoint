import {
  createKycProvider,
  KycStatus,
  KycWebhookRetryEngine,
  KycStatusPollingEngine,
  type IKycProvider,
} from './kyc-provider.service';

describe('KYC provider service', () => {
  it('creates mock provider by default', () => {
    const provider = createKycProvider('unknown');
    expect(provider.providerName).toBe('mock');
  });

  it('creates persona and shufti providers via factory', () => {
    expect(createKycProvider('persona').providerName).toBe('persona');
    expect(createKycProvider('shufti').providerName).toBe('shufti');
  });

  it('mock provider rejects risk emails and accepts webhook signature', async () => {
    const provider = createKycProvider('mock') as IKycProvider;

    const rejected = await provider.submitCustomer(
      {
        account: 'GABC',
        email: 'reject@example.com',
      },
      {}
    );

    const pending = await provider.submitCustomer(
      {
        account: 'GABC',
        email: 'pending@example.com',
      },
      {}
    );

    expect(rejected.status).toBe(KycStatus.REJECTED);
    expect(pending.status).toBe(KycStatus.PENDING);
    expect(provider.verifyWebhookSignature('{}', 'mock-valid-signature')).toBe(true);
    expect(provider.verifyWebhookSignature('{}', 'bad')).toBe(false);
  });

  it('mock parser extracts providerRef/account/status shape', () => {
    const provider = createKycProvider('mock');
    const parsed = provider.parseWebhook({
      account: 'GACC',
      providerRef: 'mock_1',
      status: 'accepted',
    });

    expect(parsed).toEqual({
      providerRef: 'mock_1',
      account: 'GACC',
      status: KycStatus.ACCEPTED,
    });
  });

  it('mock parser rejects payloads without customer identifiers', () => {
    const provider = createKycProvider('mock');
    expect(provider.parseWebhook({ status: 'accepted' })).toBeNull();
    expect(provider.parseWebhook(null)).toBeNull();
  });

  it('persona parser extracts direct inquiry response shape', () => {
    const provider = createKycProvider('persona');
    const parsed = provider.parseWebhook({
      data: {
        id: 'inq_1',
        attributes: {
          referenceId: 'GACC',
          status: 'approved',
        },
      },
    });

    expect(parsed).toEqual({
      providerRef: 'inq_1',
      account: 'GACC',
      status: KycStatus.ACCEPTED,
    });
  });

  it('persona parser extracts nested webhook event payload shape', () => {
    const provider = createKycProvider('persona');
    const parsed = provider.parseWebhook({
      data: {
        type: 'event',
        id: 'evt_1',
        attributes: {
          name: 'inquiry.approved',
          payload: {
            data: {
              type: 'inquiry',
              id: 'inq_webhook_1',
              attributes: {
                'reference-id': 'GWEBHOOK',
                status: 'approved',
              },
            },
          },
        },
      },
    });

    expect(parsed).toEqual({
      providerRef: 'inq_webhook_1',
      account: 'GWEBHOOK',
      status: KycStatus.ACCEPTED,
    });
  });

  it('persona parser maps declined event names to rejected status', () => {
    const provider = createKycProvider('persona');
    const parsed = provider.parseWebhook({
      data: {
        type: 'event',
        id: 'evt_2',
        attributes: {
          name: 'inquiry.declined',
          payload: {
            data: {
              id: 'inq_2',
              attributes: {
                'reference-id': 'GDECLINED',
              },
            },
          },
        },
      },
    });

    expect(parsed).toEqual({
      providerRef: 'inq_2',
      account: 'GDECLINED',
      status: KycStatus.REJECTED,
    });
  });

  it('shufti parser maps verification events to normalized status', () => {
    const provider = createKycProvider('shufti');

    expect(
      provider.parseWebhook({
        reference: 'shufti_ref_1',
        event: 'verification.approved',
      })
    ).toEqual({
      providerRef: 'shufti_ref_1',
      account: 'shufti_ref_1',
      status: KycStatus.ACCEPTED,
    });

    expect(
      provider.parseWebhook({
        reference: 'shufti_ref_2',
        event: 'verification.declined',
      })
    ).toEqual({
      providerRef: 'shufti_ref_2',
      account: 'shufti_ref_2',
      status: KycStatus.REJECTED,
    });

    expect(
      provider.parseWebhook({
        reference: 'shufti_ref_3',
        event: 'request.pending',
      })
    ).toEqual({
      providerRef: 'shufti_ref_3',
      account: 'shufti_ref_3',
      status: KycStatus.PENDING,
    });
  });

  it('shufti parser prefers verification_status when present', () => {
    const provider = createKycProvider('shufti');
    const parsed = provider.parseWebhook({
      reference: 'shufti_ref_4',
      event: 'verification.status.changed',
      verification_status: 'verified',
    });

    expect(parsed).toEqual({
      providerRef: 'shufti_ref_4',
      account: 'shufti_ref_4',
      status: KycStatus.ACCEPTED,
    });
  });

  describe('KycWebhookRetryEngine', () => {
    it('calculates exponential backoff delays (2s, 4s, 8s, 16s, 32s)', () => {
      const engine = new KycWebhookRetryEngine({ baseDelayMs: 2000, maxRetries: 5 });
      expect(engine.getBackoffDelay(1)).toBe(2000);
      expect(engine.getBackoffDelay(2)).toBe(4000);
      expect(engine.getBackoffDelay(3)).toBe(8000);
      expect(engine.getBackoffDelay(4)).toBe(16000);
      expect(engine.getBackoffDelay(5)).toBe(32000);
    });

    it('retries outbound webhooks on HTTP 500 errors up to 5 attempts with exponential backoff and logs status', async () => {
      const sleepFn = jest.fn().mockResolvedValue(undefined);
      const engine = new KycWebhookRetryEngine({ baseDelayMs: 2000, maxRetries: 5 }, sleepFn);

      const customFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await engine.sendOutboundKycWebhook(
        'https://partner.example.com/kyc-callback',
        { customerId: 'cust_1', status: 'ACCEPTED' },
        customFetch as unknown as typeof fetch
      );

      expect(result.delivered).toBe(false);
      expect(result.attempts).toBe(5);
      expect(result.statusCode).toBe(500);
      expect(result.logs.length).toBe(5);
      expect(customFetch).toHaveBeenCalledTimes(5);
      expect(sleepFn).toHaveBeenNthCalledWith(1, 2000);
      expect(sleepFn).toHaveBeenNthCalledWith(2, 4000);
      expect(sleepFn).toHaveBeenNthCalledWith(3, 8000);
      expect(sleepFn).toHaveBeenNthCalledWith(4, 16000);
    });

    it('succeeds immediately on 200 OK without retrying', async () => {
      const sleepFn = jest.fn().mockResolvedValue(undefined);
      const engine = new KycWebhookRetryEngine({ baseDelayMs: 2000, maxRetries: 5 }, sleepFn);

      const customFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const result = await engine.sendOutboundKycWebhook(
        'https://partner.example.com/kyc-callback',
        { customerId: 'cust_2', status: 'ACCEPTED' },
        customFetch as unknown as typeof fetch
      );

      expect(result.delivered).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.statusCode).toBe(200);
      expect(sleepFn).not.toHaveBeenCalled();
    });
  });

  describe('KycStatusPollingEngine', () => {
    it('polls status and triggers webhook retry engine on status transition', async () => {
      const provider = createKycProvider('mock');
      const engine = new KycStatusPollingEngine(provider);

      const customFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const res = await engine.pollAndNotifyStatusChange(
        { account: 'cust_poll_1', email: 'auto@example.com' },
        KycStatus.PENDING,
        'https://partner.example.com/webhook',
        customFetch as unknown as typeof fetch
      );

      expect(res.statusChanged).toBe(true);
      expect(res.currentStatus).toBe(KycStatus.ACCEPTED);
      expect(res.webhookResult?.delivered).toBe(true);
    });
  });
});
