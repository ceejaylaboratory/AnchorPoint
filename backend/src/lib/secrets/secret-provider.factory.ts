import { SecretProvider } from './secret-provider.interface';
import { EnvSecretProvider } from './env-secret-provider';
import { AwsSecretsManagerProvider } from './aws-secrets-manager-provider';
import { VaultSecretProvider } from './vault-secret-provider';

export type SecretProviderType = 'env' | 'aws' | 'vault';

/**
 * Instantiates the appropriate SecretProvider based on the `SECRET_PROVIDER`
 * environment variable (or the `providerType` argument).
 *
 * Supported values:
 *   - `env`   — reads from `process.env` (default)
 *   - `aws`   — AWS Secrets Manager (requires AWS_REGION)
 *   - `vault` — HashiCorp Vault KV v2 (requires VAULT_ADDR, VAULT_TOKEN)
 *
 * Startup fails with a clear, non-leaking error when required configuration
 * for the selected provider is missing.
 */
export function createSecretProvider(
  providerType?: SecretProviderType | string,
  cacheTtlMs?: number,
): SecretProvider {
  const type: string = providerType ?? process.env['SECRET_PROVIDER'] ?? 'env';

  switch (type.toLowerCase()) {
    case 'aws': {
      const region = process.env['AWS_REGION'];
      if (!region) {
        throw new Error(
          'SECRET_PROVIDER=aws requires AWS_REGION to be set'
        );
      }
      return new AwsSecretsManagerProvider({
        region,
        accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
        secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'],
        cacheTtlMs,
      });
    }

    case 'vault': {
      const vaultAddr = process.env['VAULT_ADDR'];
      const token = process.env['VAULT_TOKEN'];
      if (!vaultAddr) {
        throw new Error('SECRET_PROVIDER=vault requires VAULT_ADDR to be set');
      }
      if (!token) {
        throw new Error('SECRET_PROVIDER=vault requires VAULT_TOKEN to be set');
      }
      return new VaultSecretProvider({
        vaultAddr,
        token,
        mountPath: process.env['VAULT_MOUNT_PATH'] ?? 'secret',
        cacheTtlMs,
      });
    }

    case 'env':
    default:
      return new EnvSecretProvider();
  }
}
