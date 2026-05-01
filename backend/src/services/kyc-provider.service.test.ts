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

  it('persona parser extracts providerRef/account/status shape', () => {
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
});
