import { createHash } from 'node:crypto';
import { RedisService } from './redis.service';
import logger from '../utils/logger';

const JWT_BLACKLIST_PREFIX = 'jwt:blacklist:';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Revoke a JWT token by storing its hash in Redis with a TTL matching
 * the token's remaining lifetime.
 */
export async function revokeToken(
  redisService: RedisService,
  token: string,
  ttlSeconds: number
): Promise<void> {
  const key = JWT_BLACKLIST_PREFIX + hashToken(token);
  await redisService.setJSON(key, { revoked: true }, ttlSeconds);
  logger.info('JWT token revoked', { key });
}

/**
 * Check whether a JWT token has been revoked.
 */
export async function isTokenRevoked(
  redisService: RedisService,
  token: string
): Promise<boolean> {
  const key = JWT_BLACKLIST_PREFIX + hashToken(token);
  const result = await redisService.getJSON<{ revoked: boolean }>(key);
  return result?.revoked === true;
}
