import { SecretProvider } from './secret-provider.interface';

/**
 * EnvSecretProvider
 *
 * Resolves secrets directly from `process.env`. Used in local development and
 * test environments where a managed secrets store is not available.
 */
export class EnvSecretProvider implements SecretProvider {
  async getSecret(name: string): Promise<string> {
    const value = process.env[name];
    if (value === undefined || value === '') {
      throw new Error(`Secret "${name}" is not set in environment variables`);
    }
    return value;
  }

  async getSecretJson<T = unknown>(name: string): Promise<T> {
    const raw = await this.getSecret(name);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`Secret "${name}" is not valid JSON`);
    }
  }
}
