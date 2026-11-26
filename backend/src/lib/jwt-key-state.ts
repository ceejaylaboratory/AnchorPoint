import { redis } from './redis';

export const JWT_PREVIOUS_SECRET_KEY = 'jwt:previous_signing_key';

/**
 * Stores the previous JWT signing secret with a bounded TTL. Once the TTL
 * expires, tokens signed with that key can no longer be verified (#1580).
 */
export async function storePreviousJwtSecret(secret: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) {
    await redis.del(JWT_PREVIOUS_SECRET_KEY);
    return;
  }
  await redis.set(JWT_PREVIOUS_SECRET_KEY, secret, 'EX', ttlSeconds);
}

export async function getPreviousJwtSecret(): Promise<string | null> {
  return await redis.get(JWT_PREVIOUS_SECRET_KEY);
}
