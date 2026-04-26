# Feature Flags Service

## Overview

The Feature Flags Service enables gradual rollout of new features and capabilities without requiring backend redeployment. It supports multiple strategies for controlling feature availability:

- **Global toggles** - Enable/disable a feature for all users
- **Gradual rollout** - Incrementally enable features for a percentage of users
- **Targeted rollout** - Enable features only for specific users or accounts
- **Redis-backed** - Persistent storage with fast reads
- **Configuration file fallback** - Default flags defined in code

## Architecture

### Components

1. **FeatureFlagService** (`services/feature-flag.service.ts`)
   - Core service handling flag logic
   - Supports Redis and in-memory storage
   - Implements consistent hashing for deterministic rollouts

2. **Configuration** (`config/feature-flags.config.ts`)
   - Default flag definitions
   - Organized by feature type (SEPs, contracts, features)

3. **Middleware** (`api/middleware/feature-flag.middleware.ts`)
   - Express middleware to inject service into requests
   - Route-level flag checking
   - Context extraction from headers/body

4. **Admin API** (`api/routes/feature-flags.route.ts`)
   - REST endpoints for managing flags
   - Requires authentication
   - Full CRUD operations

## Usage

### Basic Setup

```typescript
import { FeatureFlagService } from './services/feature-flag.service';
import { getDefaultFlagsMap } from './config/feature-flags.config';
import Redis from 'ioredis';

// Initialize with Redis
const redis = new Redis();
const redisService = new RedisService(redis);
const featureFlagService = new FeatureFlagService(
  redisService,
  getDefaultFlagsMap()
);

// Initialize default flags
await featureFlagService.initialize(getDefaultFlagsMap());
```

### In Express App

```typescript
import { featureFlagMiddleware, checkFeatureFlag } from './api/middleware/feature-flag.middleware';
import { createFeatureFlagRouter } from './api/routes/feature-flags.route';

const app = express();

// Add middleware
app.use(featureFlagMiddleware(featureFlagService));

// Add admin routes
app.use('/api/feature-flags', createFeatureFlagRouter(featureFlagService));

// Protect routes with flags
app.get(
  '/sep6/deposit',
  checkFeatureFlag('sep6.deposit'),
  sep6DepositHandler
);
```

### Checking Flags in Code

```typescript
// Simple check
const enabled = await featureFlagService.isEnabled('sep6.deposit');

// With user context
const context = {
  userId: 'user123',
  account: 'GXXX...',
};
const enabled = await featureFlagService.isEnabled('sep6.deposit', context);

// In request handler
app.get('/deposit', async (req: Request, res: Response) => {
  const enabled = await req.featureFlagService?.isEnabled('sep6.deposit', {
    userId: req.userId,
    account: req.account,
  });

  if (!enabled) {
    return res.status(403).json({ error: 'Feature not available' });
  }

  // Handle request
});
```

## API Endpoints

All endpoints require authentication (JWT token)

### List All Flags

```
GET /api/feature-flags
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "name": "sep6.deposit",
      "enabled": true,
      "description": "Enable SEP-6 Deposit functionality",
      "rolloutPercentage": 100,
      "targetUsers": [],
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "count": 1
}
```

### Get Specific Flag

```
GET /api/feature-flags/:flagName
```

### Create Flag

```
POST /api/feature-flags
Content-Type: application/json

{
  "name": "feature.newFeature",
  "description": "New experimental feature",
  "enabled": false,
  "rolloutPercentage": 25,
  "targetUsers": ["user1", "user2"]
}
```

### Update Flag

```
PATCH /api/feature-flags/:flagName
Content-Type: application/json

{
  "enabled": true,
  "rolloutPercentage": 50,
  "targetUsers": ["user1", "user2", "user3"]
}
```

### Enable Flag

```
PUT /api/feature-flags/:flagName/enable
```

### Disable Flag

```
PUT /api/feature-flags/:flagName/disable
```

### Update Rollout Percentage

```
PUT /api/feature-flags/:flagName/rollout
Content-Type: application/json

{
  "percentage": 75
}
```

### Add Target Users

```
POST /api/feature-flags/:flagName/target-users
Content-Type: application/json

{
  "userIds": ["user4", "user5"]
}
```

### Remove Target Users

```
DELETE /api/feature-flags/:flagName/target-users
Content-Type: application/json

{
  "userIds": ["user2"]
}
```

### Delete Flag

```
DELETE /api/feature-flags/:flagName
```

## Rollout Strategies

### Strategy 1: Global Toggle

Simple on/off for all users:

```typescript
await featureFlagService.disableFlag('sep6.deposit');
// Feature is now disabled for everyone
```

### Strategy 2: Gradual Rollout

Enable for a percentage of users using consistent hashing:

```typescript
const flag = await featureFlagService.getFlag('sep31.send');
flag.rolloutPercentage = 25; // Enable for 25% of users
await featureFlagService.setFlag('sep31.send', flag);
```

**How it works:**
- Uses deterministic hashing of `userId:flagName`
- Same user always gets consistent result
- Safe for gradual ramp-up

### Strategy 3: Targeted Rollout

Enable for specific users only:

```typescript
const flag = await featureFlagService.getFlag('contract.flashLoan');
flag.enabled = true;
flag.targetUsers = ['user123', 'user456'];
await featureFlagService.setFlag('contract.flashLoan', flag);
```

## Predefined Flags

### SEP-6 Flags
- `sep6.enabled` - Enable/disable SEP-6
- `sep6.deposit` - Enable/disable deposits
- `sep6.withdraw` - Enable/disable withdrawals

### SEP-24 Flags
- `sep24.enabled` - Enable/disable SEP-24
- `sep24.deposit` - Enable/disable hosted deposits
- `sep24.withdraw` - Enable/disable hosted withdrawals

### SEP-31 Flags
- `sep31.enabled` - Enable/disable SEP-31
- `sep31.send` - Enable/disable sending
- `sep31.receive` - Enable/disable receiving

### SEP-38 Flags
- `sep38.enabled` - Enable/disable quotes

### Contract Flags
- `contract.swap` - AMM swaps
- `contract.staking` - Staking
- `contract.liquidStaking` - Liquid staking
- `contract.flashLoan` - Flash loans
- `contract.amm` - Automated market maker

### Feature Flags
- `feature.multisig` - Multisig transactions
- `feature.batchPayments` - Batch payments
- `feature.webhooks` - Webhooks
- `feature.rateLimit` - Rate limiting
- `feature.circuitBreaker` - Circuit breaker
- `feature.analyticsTracking` - Analytics

## Storage

### Redis (Recommended for Production)

```typescript
import Redis from 'ioredis';
import { RedisService } from './services/redis.service';

const redis = new Redis({
  host: 'localhost',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
});

const redisService = new RedisService(redis);
const featureFlagService = new FeatureFlagService(redisService);
```

**Redis Keys:**
- `feature_flag:{flagName}` - Individual flag
- `feature_flags_all` - Cache of all flags (5-min TTL)

### Configuration File (Development)

Flags are automatically loaded from `config/feature-flags.config.ts`:

```typescript
const featureFlagService = new FeatureFlagService(
  undefined, // no Redis
  getDefaultFlagsMap()
);
```

## Error Handling

The service gracefully handles errors:

- **Missing flags** - Returns `false` by default
- **Redis errors** - Falls back to in-memory storage
- **Invalid percentages** - Throws `RangeError`
- **Service errors** - Logged and request proceeds (fail open)

## Performance Considerations

1. **Caching**: All flags cached in Redis with 5-minute TTL
2. **Consistent Hashing**: O(1) rollout calculation
3. **No N+1 Queries**: Single Redis get per flag check
4. **Thread-safe**: Redis provides atomic operations

## Security

1. **Authentication Required**: Admin endpoints require JWT token
2. **Access Control**: Integrate with authorization middleware
3. **Audit Trail**: All flag changes logged
4. **No Sensitive Data**: Avoid storing sensitive info in flag names

## Monitoring

Track flag usage in application metrics:

```typescript
async isEnabled(flagName: string, context?: FeatureFlagContext) {
  const start = Date.now();
  const result = await this.checkFlag(flagName, context);
  const duration = Date.now() - start;

  // Send to metrics
  metrics.histogram('feature_flag.check.duration', duration);
  metrics.counter(`feature_flag.${flagName}.${result ? 'enabled' : 'disabled'}`);

  return result;
}
```

## Troubleshooting

### Flag not working

1. Check flag exists: `GET /api/feature-flags/:flagName`
2. Verify enabled: `enabled: true`
3. Check rollout: `rolloutPercentage >= 100` or user in `targetUsers`
4. Check context passed: `userId` or `account` available

### Performance issues

1. Check Redis connectivity
2. Monitor flag check latency
3. Review cache TTL settings
4. Verify hashing algorithm efficiency

## Examples

### Canary Deployment

Roll out a new SEP-31 feature to 10% of users:

```bash
# Start with percentage
curl -X PUT http://localhost:3002/api/feature-flags/sep31.send/rollout \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"percentage": 10}'

# Monitor performance

# Increase to 50%
curl -X PUT http://localhost:3002/api/feature-flags/sep31.send/rollout \
  -H "Authorization: Bearer <token>" \
  -d '{"percentage": 50}'

# Full rollout
curl -X PUT http://localhost:3002/api/feature-flags/sep31.send/rollout \
  -H "Authorization: Bearer <token>" \
  -d '{"percentage": 100}'
```

### Target User Beta Testing

Enable flash loans for beta testers:

```bash
# Get current flag
curl http://localhost:3002/api/feature-flags/contract.flashLoan \
  -H "Authorization: Bearer <token>"

# Add beta testers
curl -X POST http://localhost:3002/api/feature-flags/contract.flashLoan/target-users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"userIds": ["beta_user_1", "beta_user_2"]}'

# Verify
curl http://localhost:3002/api/feature-flags/contract.flashLoan \
  -H "Authorization: Bearer <token>"
```

### Kill Switch

Instantly disable a feature:

```bash
curl -X PUT http://localhost:3002/api/feature-flags/sep6.deposit/disable \
  -H "Authorization: Bearer <token>"
```

## Testing

Run unit tests:

```bash
npm test -- src/services/feature-flag.service.test.ts
```

Example test:

```typescript
it('should enable feature for percentage of users', async () => {
  const context = { userId: 'user123' };
  const result = await service.isEnabled('test.rollout', context);
  expect(typeof result).toBe('boolean');
});
```

## Future Enhancements

1. **A/B Testing** - Route variants by feature flag
2. **Feature Analytics** - Track adoption and errors per flag
3. **Scheduled Rollouts** - Automatic percentage increases
4. **Experiment Framework** - Statistical significance testing
5. **Flag Dependencies** - Flag X depends on Flag Y
6. **Audit Dashboard** - UI for flag management
