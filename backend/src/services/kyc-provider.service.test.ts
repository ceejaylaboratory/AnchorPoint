import {
  createKycProvider,
  KycStatus,
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
        email: 'ok@example.com',
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
});
