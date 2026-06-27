# Redis-based SEP-10 Challenge Storage

This implementation adds Redis support for storing short-lived SEP-10 challenges, improving security and performance.

## Features

- **Secure Challenge Storage**: Challenges are stored in Redis with automatic expiration (5 minutes TTL)
- **Replay Attack Prevention**: Challenges are removed after successful verification
- **Performance**: Fast Redis-based storage instead of in-memory or database storage
- **Scalability**: Supports multiple server instances sharing the same Redis instance

## Implementation

### Auth Service Updates

The `auth.service.ts` has been enhanced with the following functions:

- `generateChallenge()`: Generates a cryptographically secure random challenge
- `storeChallenge()`: Stores challenge in Redis with TTL
- `getChallenge()`: Retrieves challenge from Redis
- `removeChallenge()`: Removes challenge after verification

### Redis Key Format

Challenges are stored with the key format: `sep10:challenge:{publicKey}`

### Usage Example

```typescript
import { RedisService } from './services/redis.service';
import { generateChallenge, storeChallenge, getChallenge, removeChallenge } from './services/auth.service';

// Generate and store a challenge
const challenge = generateChallenge();
await storeChallenge(redisService, publicKey, challenge);

// Later, verify the challenge
const storedChallenge = await getChallenge(redisService, publicKey);
if (storedChallenge && storedChallenge.challenge === submittedChallenge) {
  // Challenge is valid, remove it to prevent replay
  await removeChallenge(redisService, publicKey);
  // Generate JWT token...
}
```

## Security Benefits

1. **Time-based Expiration**: Challenges automatically expire after 5 minutes
2. **One-time Use**: Challenges are removed after successful verification
3. **Distributed Security**: Works across multiple server instances
4. **Memory Efficiency**: Challenges don't consume application memory

## Configuration

Ensure your Redis client is properly configured and passed to the RedisService constructor. The implementation uses the existing RedisService interface for consistency.

## Testing

Comprehensive tests are included for all new functionality:
- Challenge generation
- Redis storage and retrieval
- TTL behavior
- Error handling