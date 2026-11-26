/**
 * SecretProvider interface
 *
 * Abstracts secret resolution from the backing store. Implementations must
 * be safe to call from application startup before traffic is served.
 */
export interface SecretProvider {
  /**
   * Retrieve a secret value as a plain string.
   * Throws a descriptive (but non-leaking) error when the secret is absent or
   * the backing store is unreachable.
   */
  getSecret(name: string): Promise<string>;

  /**
   * Retrieve a secret and parse it as JSON, returning the typed value.
   * Throws when the secret is absent, the store is unreachable, or the value
   * cannot be parsed as valid JSON.
   */
  getSecretJson<T = unknown>(name: string): Promise<T>;
}
