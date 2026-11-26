import { SecretProvider } from './secret-provider.interface';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export interface AwsSecretsManagerProviderConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Time-to-live in milliseconds for cached secret values. Default: 3600000 (1 hour). */
  cacheTtlMs?: number;
}

/**
 * AwsSecretsManagerProvider
 *
 * Fetches secrets from AWS Secrets Manager. Secret values are cached in memory
 * for `cacheTtlMs` milliseconds (default 1 hour) to minimise API calls and
 * reduce latency after the first fetch.
 */
export class AwsSecretsManagerProvider implements SecretProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly region: string;
  private readonly credentials?: { accessKeyId: string; secretAccessKey: string };

  constructor(config: AwsSecretsManagerProviderConfig) {
    this.region = config.region;
    this.cacheTtlMs = config.cacheTtlMs ?? 3_600_000;
    if (config.accessKeyId && config.secretAccessKey) {
      this.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }
  }

  async getSecret(name: string): Promise<string> {
    const cached = this.cache.get(name);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    // Lazy-load AWS SDK so the package is only required when this provider is used.
    let SecretsManagerClient: any;
    let GetSecretValueCommand: any;
    try {
      const sdk = await import('@aws-sdk/client-secrets-manager');
      SecretsManagerClient = sdk.SecretsManagerClient;
      GetSecretValueCommand = sdk.GetSecretValueCommand;
    } catch {
      throw new Error(
        'AWS SDK is not installed. Add @aws-sdk/client-secrets-manager to your dependencies.'
      );
    }

    const client = new SecretsManagerClient({
      region: this.region,
      ...(this.credentials ? { credentials: this.credentials } : {}),
    });

    let secretValue: string;
    try {
      const response = await client.send(new GetSecretValueCommand({ SecretId: name }));
      secretValue = response.SecretString ?? '';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Avoid leaking any returned secret fragments — only forward the error type/code.
      throw new Error(`Failed to retrieve secret "${name}" from AWS Secrets Manager: ${msg.split('\n')[0]}`);
    }

    if (!secretValue) {
      throw new Error(`Secret "${name}" exists in AWS Secrets Manager but has an empty value`);
    }

    this.cache.set(name, { value: secretValue, expiresAt: Date.now() + this.cacheTtlMs });
    return secretValue;
  }

  async getSecretJson<T = unknown>(name: string): Promise<T> {
    const raw = await this.getSecret(name);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Secret "${name}" from AWS Secrets Manager is not valid JSON`);
    }
  }

  /** Evict a single entry from the in-memory cache (useful after rotation). */
  invalidate(name: string): void {
    this.cache.delete(name);
  }

  /** Flush the entire in-memory cache. */
  invalidateAll(): void {
    this.cache.clear();
  }
}
