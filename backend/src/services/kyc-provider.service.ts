import crypto from 'crypto';
import CircuitBreaker from 'opossum';

import { config } from '../config/env';

export enum KycStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  PENDING_PROVIDER_RETRY = 'PENDING_PROVIDER_RETRY',
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

class CircuitBreakerKycProvider implements IKycProvider {
  private provider: IKycProvider;
  private breaker: CircuitBreaker<[KycSubmissionInput, Record<string, string>], KycSubmissionResult>;

  constructor(provider: IKycProvider) {
    this.provider = provider;

    const options = {
      errorThresholdPercentage: 100,
      volumeThreshold: 5,
      rollingCountTimeout: 30000,
      resetTimeout: 30000,
    };

    this.breaker = new CircuitBreaker(
      (data, documents) => this.provider.submitCustomer(data, documents),
      options
    );

    this.breaker.fallback(() => ({
      success: false,
      status: KycStatus.PENDING_PROVIDER_RETRY,
      message: 'KYC provider is currently unavailable. Will retry later.',
    }));
  }

  get providerName(): string {
    return this.provider.providerName;
  }

  submitCustomer(
    data: KycSubmissionInput,
    documents: Record<string, string>
  ): Promise<KycSubmissionResult> {
    return this.breaker.fire(data, documents);
  }

  verifyWebhookSignature(
    payload: string,
    signature: string | undefined,
    headers?: Record<string, unknown>
  ): boolean {
    return this.provider.verifyWebhookSignature(payload, signature, headers);
  }

  parseWebhook(payload: unknown): KycWebhookResult | null {
    return this.provider.parseWebhook(payload);
  }
}

export const createKycProvider = (provider: string): IKycProvider => {
  let baseProvider: IKycProvider;
  switch (provider) {
    case 'persona':
      baseProvider = new PersonaKycProvider();
      break;
    case 'shufti':
      baseProvider = new ShuftiKycProvider();
      break;
    case 'mock':
    default:
      baseProvider = new MockKycProvider();
      break;
  }
  return new CircuitBreakerKycProvider(baseProvider);
};

export const kycProvider = createKycProvider(config.KYC_PROVIDER);

export interface OutboundKycWebhookOptions {
  url?: string;
  maxRetries?: number;
  baseDelayMs?: number;
}

export interface KycWebhookDeliveryLog {
  attempt: number;
  timestamp: string;
  statusCode?: number;
  error?: string;
  success: boolean;
}

export class KycWebhookRetryEngine {
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    options: Partial<OutboundKycWebhookOptions> = {},
    sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((res) => setTimeout(res, ms))
  ) {
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 2000;
    this.sleepFn = sleepFn;
  }

  getBackoffDelay(attempt: number): number {
    return this.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  }

  async sendOutboundKycWebhook(
    targetUrl: string,
    payload: Record<string, unknown>,
    customFetch?: typeof fetch
  ): Promise<{
    delivered: boolean;
    attempts: number;
    statusCode?: number;
    logs: KycWebhookDeliveryLog[];
    error?: string;
  }> {
    const fetchImpl = customFetch ?? fetch;
    const bodyStr = JSON.stringify(payload);
    const logs: KycWebhookDeliveryLog[] = [];
    let lastStatusCode: number | undefined;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const timestamp = new Date().toISOString();
      try {
        const response = await fetchImpl(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-KYC-Attempt': String(attempt),
          },
          body: bodyStr,
        });

        lastStatusCode = response.status;

        if (response.ok) {
          logs.push({
            attempt,
            timestamp,
            statusCode: response.status,
            success: true,
          });
          return {
            delivered: true,
            attempts: attempt,
            statusCode: response.status,
            logs,
          };
        }

        lastError = `HTTP ${response.status}`;
        logs.push({
          attempt,
          timestamp,
          statusCode: response.status,
          error: lastError,
          success: false,
        });

        if (attempt < this.maxRetries) {
          const delay = this.getBackoffDelay(attempt);
          await this.sleepFn(delay);
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logs.push({
          attempt,
          timestamp,
          error: lastError,
          success: false,
        });

        if (attempt < this.maxRetries) {
          const delay = this.getBackoffDelay(attempt);
          await this.sleepFn(delay);
        }
      }
    }

    return {
      delivered: false,
      attempts: this.maxRetries,
      statusCode: lastStatusCode,
      logs,
      error: lastError ?? 'Exhausted retry attempts',
    };
  }
}

export class KycStatusPollingEngine {
  private provider: IKycProvider;
  private retryEngine: KycWebhookRetryEngine;

  constructor(
    provider: IKycProvider = kycProvider,
    retryEngine: KycWebhookRetryEngine = new KycWebhookRetryEngine()
  ) {
    this.provider = provider;
    this.retryEngine = retryEngine;
  }

  async pollAndNotifyStatusChange(
    submissionData: KycSubmissionInput,
    previousStatus: KycStatus,
    partnerWebhookUrl?: string,
    customFetch?: typeof fetch
  ): Promise<{
    currentStatus: KycStatus;
    statusChanged: boolean;
    webhookResult?: { delivered: boolean; attempts: number; statusCode?: number };
  }> {
    const res = await this.provider.submitCustomer(submissionData, {});
    const currentStatus = res.status;
    const statusChanged = currentStatus !== previousStatus;

    if (statusChanged && partnerWebhookUrl) {
      const webhookPayload = {
        event: 'customer.kyc_status_updated',
        account: submissionData.account,
        previousStatus,
        currentStatus,
        occurredAt: new Date().toISOString(),
      };
      const delivery = await this.retryEngine.sendOutboundKycWebhook(
        partnerWebhookUrl,
        webhookPayload,
        customFetch
      );
      return {
        currentStatus,
        statusChanged,
        webhookResult: {
          delivered: delivery.delivered,
          attempts: delivery.attempts,
          statusCode: delivery.statusCode,
        },
      };
    }

    return {
      currentStatus,
      statusChanged,
    };
  }
}

