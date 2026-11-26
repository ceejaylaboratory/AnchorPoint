import { SecretProvider } from './secret-provider.interface';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export interface VaultSecretProviderConfig {
  vaultAddr: string;
  token: string;
  /** KV mount path prefix (default: "secret"). */
  mountPath?: string;
  /** Time-to-live in milliseconds for cached secret values. Default: 3600000 (1 hour). */
  cacheTtlMs?: number;
}

/**
 * VaultSecretProvider
 *
 * Resolves secrets from HashiCorp Vault's KV v2 secrets engine using the HTTP
 * API directly (no extra SDK dependency). Secret values are cached in memory
 * with a configurable TTL (default 1 hour).
 *
 * Secret `name` maps to the KV path:
 *   `{mountPath}/data/{name}`
 *
 * The secret must contain a key named `value`. For structured secrets, use
 * `getSecretJson` which returns the entire data object.
 */
export class VaultSecretProvider implements SecretProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly mountPath: string;

  constructor(config: VaultSecretProviderConfig) {
    this.baseUrl = config.vaultAddr.replace(/\/$/, '');
    this.token = config.token;
    this.mountPath = config.mountPath ?? 'secret';
    this.cacheTtlMs = config.cacheTtlMs ?? 3_600_000;
  }

  async getSecret(name: string): Promise<string> {
    const cached = this.cache.get(name);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    const data = await this.fetchKvData(name);

    // KV v2 convention: the caller stores the secret under key "value".
    const value = (data as Record<string, unknown>)['value'];
    if (typeof value !== 'string' || value === '') {
      throw new Error(
        `Secret "${name}" in Vault does not contain a string "value" key. ` +
        'Store the secret as { "value": "<secret>" } or use getSecretJson for structured data.'
      );
    }

    this.cache.set(name, { value, expiresAt: Date.now() + this.cacheTtlMs });
    return value;
  }

  async getSecretJson<T = unknown>(name: string): Promise<T> {
    const cacheKey = `__json__${name}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return JSON.parse(cached.value) as T;
    }

    const data = await this.fetchKvData(name);
    const serialized = JSON.stringify(data);
    this.cache.set(cacheKey, { value: serialized, expiresAt: Date.now() + this.cacheTtlMs });
    return data as T;
  }

  private async fetchKvData(name: string): Promise<unknown> {
    const url = `${this.baseUrl}/v1/${this.mountPath}/data/${name}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'X-Vault-Token': this.token },
      });
    } catch (err: unknown) {
      throw new Error(
        `Network error fetching secret "${name}" from Vault: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (response.status === 404) {
      throw new Error(`Secret "${name}" not found in Vault (path: ${this.mountPath}/data/${name})`);
    }

    if (response.status === 403) {
      throw new Error(`Permission denied reading secret "${name}" from Vault`);
    }

    if (!response.ok) {
      throw new Error(
        `Vault returned HTTP ${response.status} for secret "${name}"`
      );
    }

    let body: { data?: { data?: unknown } };
    try {
      body = await response.json() as typeof body;
    } catch {
      throw new Error(`Vault returned non-JSON response for secret "${name}"`);
    }

    const data = body?.data?.data;
    if (data === undefined || data === null) {
      throw new Error(`Secret "${name}" exists in Vault but has no data`);
    }

    return data;
  }

  /** Evict a single entry from the in-memory cache (useful after rotation). */
  invalidate(name: string): void {
    this.cache.delete(name);
    this.cache.delete(`__json__${name}`);
  }

  /** Flush the entire in-memory cache. */
  invalidateAll(): void {
    this.cache.clear();
  }
}
