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

const getString = (
  obj: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined => {
  if (!obj) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
};

const extractStatusToken = (rawStatus: string): string => {
  const value = rawStatus.toLowerCase();
  if (value.includes('.')) {
    return value.split('.').pop() ?? value;
  }
  return value.replace(/_/g, '-');
};

const normalizeStatus = (rawStatus: string): KycStatus => {
  const value = extractStatusToken(rawStatus);
  if (['approved', 'accepted', 'completed', 'verified', 'clear'].includes(value)) {
    return KycStatus.ACCEPTED;
  }

  if (['declined', 'rejected', 'denied', 'failed'].includes(value)) {
    return KycStatus.REJECTED;
  }

  return KycStatus.PENDING;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const timingSafeMatch = (expected: string, actual: string): boolean => {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};

class MockKycProvider implements IKycProvider {
  readonly providerName = 'mock';

  async submitCustomer(
    data: KycSubmissionInput,
    _documents: Record<string, string> = {}
  ): Promise<KycSubmissionResult> {
    if (data.email && data.email.includes('reject')) {
      return {
        success: true,
        providerRef: `mock_${Date.now()}`,
        status: KycStatus.REJECTED,
        message: 'Customer rejected by risk policy.',
      };
    }

    if (data.email && data.email.includes('pending')) {
      return {
        success: true,
        providerRef: `mock_${Date.now()}`,
        status: KycStatus.PENDING,
        message: 'Customer submitted successfully. Pending review.',
      };
    }

    return {
      success: true,
      providerRef: `mock_${Date.now()}`,
      status: KycStatus.ACCEPTED,
      message: 'Customer approved automatically.',
    };
  }

  verifyWebhookSignature(_payload: string, signature: string | undefined): boolean {
    return signature === 'mock-valid-signature';
  }

  parseWebhook(payload: unknown): KycWebhookResult | null {
    const body = asRecord(payload);
    if (!body) return null;

    const account = getString(body, 'account');
    const providerRef = getString(body, 'providerRef');
    if (!account && !providerRef) return null;

    const status = getString(body, 'status');
    return {
      account,
      providerRef,
      status: status ? normalizeStatus(status) : KycStatus.PENDING,
    };
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
    const body = asRecord(payload);
    const data = asRecord(body?.data);
    if (!data) return null;

    const attributes = asRecord(data.attributes);
    const eventPayload = asRecord(attributes?.payload);
    const inquiry = asRecord(eventPayload?.data);
    const inquiryAttributes = asRecord(inquiry?.attributes);

    const providerRef = getString(inquiry, 'id') ?? getString(data, 'id');
    const account =
      getString(inquiryAttributes, 'reference-id', 'referenceId') ??
      getString(attributes, 'reference-id', 'referenceId');
    if (!providerRef && !account) return null;

    const statusSource =
      getString(inquiryAttributes, 'status') ??
      getString(attributes, 'name') ??
      getString(attributes, 'status');

    return {
      providerRef,
      account,
      status: statusSource ? normalizeStatus(statusSource) : KycStatus.PENDING,
    };
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
    const body = asRecord(payload);
    if (!body) return null;

    const providerRef = getString(body, 'reference');
    const account = providerRef;
    if (!providerRef && !account) return null;

    const statusSource = getString(body, 'verification_status', 'event');

    return {
      providerRef,
      account,
      status: statusSource ? normalizeStatus(statusSource) : KycStatus.PENDING,
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
