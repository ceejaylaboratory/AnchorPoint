import crypto from 'crypto';

import { config } from '../config/env';

export enum KycStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export interface KycSubmissionInput {
  account: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  extraFields?: Record<string, unknown>;
}

export interface KycSubmissionResult {
  success: boolean;
  status: KycStatus;
  providerRef?: string;
  message?: string;
}

export interface KycWebhookResult {
  account?: string;
  providerRef?: string;
  status: KycStatus;
}

export interface IKycProvider {
  readonly providerName: string;
  submitCustomer(
    data: KycSubmissionInput,
    documents: Record<string, string>
  ): Promise<KycSubmissionResult>;
  verifyWebhookSignature(
    payload: string,
    signature: string | undefined,
    headers?: Record<string, unknown>
  ): boolean;
  parseWebhook(payload: unknown): KycWebhookResult | null;
}

const normalizeStatus = (rawStatus: string): KycStatus => {
  const value = rawStatus.toLowerCase();
  if (['approved', 'accepted', 'completed', 'verified', 'clear'].includes(value)) {
    return KycStatus.ACCEPTED;
  }

  if (['declined', 'rejected', 'denied', 'failed'].includes(value)) {
    return KycStatus.REJECTED;
  }

  return KycStatus.PENDING;
};

const timingSafeMatch = (expected: string, actual: string): boolean => {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

class MockKycProvider implements IKycProvider {
  readonly providerName = 'mock';

  async submitCustomer(data: KycSubmissionInput): Promise<KycSubmissionResult> {
    if (data.email && data.email.includes('reject')) {
      return {
        success: true,
        providerRef: `mock_${Date.now()}`,
        status: KycStatus.REJECTED,
        message: 'Customer rejected by risk policy.',
      };
    }

    return {
      success: true,
      providerRef: `mock_${Date.now()}`,
      status: KycStatus.PENDING,
      message: 'Customer submitted successfully. Pending review.',
    };
  }

  verifyWebhookSignature(_payload: string, signature: string | undefined): boolean {
    return signature === 'mock-valid-signature';
  }

  parseWebhook(payload: unknown): KycWebhookResult | null {
    if (!payload || typeof payload !== 'object') return null;
    const body = payload as Record<string, unknown>;
    const account = typeof body.account === 'string' ? body.account : undefined;
    const providerRef = typeof body.providerRef === 'string' ? body.providerRef : undefined;
    const status = typeof body.status === 'string' ? normalizeStatus(body.status) : KycStatus.PENDING;

    return { account, providerRef, status };
  }
}

class PersonaKycProvider implements IKycProvider {
  readonly providerName = 'persona';

  private get apiKey(): string {
    if (!config.PERSONA_API_KEY) {
      throw new Error('PERSONA_API_KEY is required when KYC_PROVIDER=persona');
    }
    return config.PERSONA_API_KEY;
  }

  async submitCustomer(
    data: KycSubmissionInput,
    documents: Record<string, string>
  ): Promise<KycSubmissionResult> {
    const response = await fetch(`${config.PERSONA_API_URL}/inquiries`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'inquiry',
          attributes: {
            referenceId: data.account,
            fields: {
              nameFirst: data.firstName,
              nameLast: data.lastName,
              emailAddress: data.email,
              ...data.extraFields,
              documents,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Persona submission failed with status ${response.status}`);
    }

    const body = (await response.json()) as {
      data?: { id?: string; attributes?: { status?: string } };
    };

    return {
      success: true,
      providerRef: body.data?.id,
      status: normalizeStatus(body.data?.attributes?.status ?? 'pending'),
    };
  }

  verifyWebhookSignature(payload: string, signature: string | undefined): boolean {
    if (!config.KYC_WEBHOOK_SECRET || !signature) return false;
    const expected = crypto
      .createHmac('sha256', config.KYC_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    return timingSafeMatch(expected, signature);
  }

  parseWebhook(payload: unknown): KycWebhookResult | null {
    if (!payload || typeof payload !== 'object') return null;
    const body = payload as Record<string, unknown>;
    const data = body.data as Record<string, unknown> | undefined;
    const attributes = data?.attributes as Record<string, unknown> | undefined;

    if (!data || typeof data !== 'object') return null;

    const providerRef = typeof data.id === 'string' ? data.id : undefined;
    const account =
      typeof attributes?.referenceId === 'string' ? attributes.referenceId : undefined;
    const status =
      typeof attributes?.status === 'string'
        ? normalizeStatus(attributes.status)
        : KycStatus.PENDING;

    return { providerRef, account, status };
  }
}

class ShuftiKycProvider implements IKycProvider {
  readonly providerName = 'shufti';

  private get credentials(): { clientId: string; secretKey: string } {
    if (!config.SHUFTI_CLIENT_ID || !config.SHUFTI_SECRET_KEY) {
      throw new Error(
        'SHUFTI_CLIENT_ID and SHUFTI_SECRET_KEY are required when KYC_PROVIDER=shufti'
      );
    }

    return {
      clientId: config.SHUFTI_CLIENT_ID,
      secretKey: config.SHUFTI_SECRET_KEY,
    };
  }

  async submitCustomer(
    data: KycSubmissionInput,
    documents: Record<string, string>
  ): Promise<KycSubmissionResult> {
    const { clientId, secretKey } = this.credentials;
    const auth = Buffer.from(`${clientId}:${secretKey}`).toString('base64');

    const response = await fetch(config.SHUFTI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference: data.account,
        email: data.email,
        country: data.extraFields?.country,
        callback_url: `${config.INTERACTIVE_URL}/sep12/webhook`,
        verification_mode: 'image_only',
        document: {
          proof: 'id_card',
          ...documents,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Shufti submission failed with status ${response.status}`);
    }

    const body = (await response.json()) as {
      reference?: string;
      event?: string;
      verification_status?: string;
    };

    return {
      success: true,
      providerRef: body.reference,
      status: normalizeStatus(body.verification_status ?? body.event ?? 'pending'),
    };
  }

  verifyWebhookSignature(payload: string, signature: string | undefined): boolean {
    if (!config.KYC_WEBHOOK_SECRET || !signature) return false;

    const expected = crypto
      .createHmac('sha256', config.KYC_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    return timingSafeMatch(expected, signature);
  }

  parseWebhook(payload: unknown): KycWebhookResult | null {
    if (!payload || typeof payload !== 'object') return null;
    const body = payload as Record<string, unknown>;

    const providerRef = typeof body.reference === 'string' ? body.reference : undefined;
    const account = typeof body.reference === 'string' ? body.reference : undefined;
    const statusSource =
      typeof body.verification_status === 'string'
        ? body.verification_status
        : typeof body.event === 'string'
          ? body.event
          : 'pending';

    return {
      providerRef,
      account,
      status: normalizeStatus(statusSource),
    };
  }
}

export const createKycProvider = (provider: string): IKycProvider => {
  switch (provider) {
    case 'persona':
      return new PersonaKycProvider();
    case 'shufti':
      return new ShuftiKycProvider();
    case 'mock':
    default:
      return new MockKycProvider();
  }
};

export const kycProvider = createKycProvider(config.KYC_PROVIDER);
