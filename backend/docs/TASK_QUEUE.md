# Distributed Task Queue for Contract Interactions

## Overview

The Distributed Task Queue system provides a robust, scalable solution for handling long-running smart contract interactions on the Stellar blockchain. Built on BullMQ and Redis, it offers retry logic, job prioritization, and transparent status tracking.

## Features

### 1. Retry Logic
- **Automatic Retries**: Failed jobs are automatically retried with exponential backoff
- **Error-Specific Strategies**: Different retry strategies for different error types
- **Configurable Attempts**: Set maximum retry attempts per job type
- **Smart Backoff**: Exponential or fixed delay strategies

### 2. Job Prioritization
- **Four Priority Levels**: LOW, NORMAL, HIGH, URGENT
- **Priority Queue**: Higher priority jobs processed first
- **Settlement Priority**: Urgent settlement tasks get immediate attention
- **Custom Priorities**: Set priority per job

### 3. Status Tracking
- **Real-time Status**: Track job progress in real-time
- **Database Persistence**: Job history stored in database
- **Progress Updates**: Jobs report progress percentage
- **Transparent Errors**: Detailed error messages and stack traces

### 4. Job Types

#### CONTRACT_CALL
Standard smart contract function calls.
- **Attempts**: 5
- **Backoff**: Exponential (3s base)
- **Priority**: NORMAL

#### CONTRACT_DEPLOY
Deploy new smart contracts.
- **Attempts**: 3
- **Backoff**: Exponential (5s base)
- **Priority**: HIGH

#### SETTLEMENT
Critical settlement operations.
- **Attempts**: 10
- **Backoff**: Exponential (2s base)
- **Priority**: URGENT

#### TRANSACTION_SUBMIT
Submit Stellar transactions.
- **Attempts**: 5
- **Backoff**: Exponential (2s base)
- **Priority**: HIGH

#### BATCH_OPERATION
Process multiple operations in batch.
- **Attempts**: 3
- **Backoff**: Fixed (10s)
- **Priority**: LOW

## Architecture

### Components

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   API       │─────▶│   Queue     │─────▶│   Worker    │
│ Controller  │      │  Service    │      │  Process    │
└─────────────┘      └─────────────┘      └─────────────┘
       │                    │                     │
       │                    │                     │
       ▼                    ▼                     ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Database   │      │    Redis    │      │   Stellar   │
│  (Prisma)   │      │   (BullMQ)  │      │   Network   │
└─────────────┘      └─────────────┘      └─────────────┘
```

### Data Flow

1. **Job Creation**: API receives request and creates job
2. **Queue Addition**: Job added to Redis queue via BullMQ
3. **Database Record**: Job metadata stored in PostgreSQL/SQLite
4. **Worker Processing**: Worker picks up job and processes it
5. **Progress Updates**: Worker reports progress to queue
6. **Result Storage**: Job result/error stored in database
7. **Status Tracking**: Frontend polls for job status

## API Endpoints

### Create Job

```http
POST /api/queue/jobs
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "CONTRACT_CALL",
  "contractId": "CXXXXXXX...",
  "functionName": "transfer",
  "parameters": {
    "from": "GXXXXX...",
    "to": "GXXXXX...",
    "amount": "1000"
  },
  "priority": 2,
  "metadata": {
    "description": "Transfer tokens"
  }
}
```

### Create Settlement Job

```http
POST /api/queue/jobs/settlement
Authorization: Bearer <token>
Content-Type: application/json

{
  "contractId": "CXXXXXXX...",
  "functionName": "settle",
  "parameters": {
    "batchId": "batch_123",
    "amount": "50000"
  }
}
```

### Get Job Status

```http
GET /api/queue/jobs/{jobId}
Authorization: Bearer <token>
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "job": {
      "id": "uuid",
      "jobId": "bullmq-job-id",
      "type": "CONTRACT_CALL",
      "status": "COMPLETED",
      "priority": "NORMAL",
      "attempts": 1,
      "maxAttempts": 5,
      "result": {
        "success": true,
        "transactionId": "abc123..."
      },
      "createdAt": "2024-01-01T00:00:00Z",
      "completedAt": "2024-01-01T00:00:05Z"
    }
  }
}
```

### Get My Jobs

```http
GET /api/queue/my-jobs?limit=50
Authorization: Bearer <token>
```

### Retry Failed Job

```http
POST /api/queue/jobs/{jobId}/retry
Authorization: Bearer <token>
```

### Cancel Job

```http
POST /api/queue/jobs/{jobId}/cancel
Authorization: Bearer <token>
```

### Get Queue Metrics

```http
GET /api/queue/metrics
Authorization: Bearer <token>
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "metrics": {
      "queue": {
        "waiting": 5,
        "active": 2,
        "completed": 150,
        "failed": 3,
        "delayed": 1,
        "total": 161
      },
      "database": {
        "PENDING": 5,
        "ACTIVE": 2,
        "COMPLETED": 150,
        "FAILED": 3
      }
    }
  }
}
```

## Error Handling

### Retryable Errors

The system automatically retries these errors:

#### too_early
Transaction submitted too early (Stellar sequence number issue).
- **Max Attempts**: 10
- **Delay**: 5s
- **Backoff**: 1.5x multiplier

#### transaction_failed
Transaction failed on Stellar network.
- **Max Attempts**: 5
- **Delay**: 3s
- **Backoff**: 2x multiplier

#### insufficient_balance
Account has insufficient balance.
- **Max Attempts**: 3
- **Delay**: 10s
- **Backoff**: No multiplier (fixed)

#### network_error
Network connectivity issues.
- **Max Attempts**: 7
- **Delay**: 2s
- **Backoff**: 2x multiplier

### Non-Retryable Errors

These errors fail immediately:
- Invalid parameters
- Contract not found
- Unauthorized access
- Invalid signature

## Usage Examples

### Example 1: Simple Contract Call

```typescript
import axios from 'axios';

const API_URL = 'http://localhost:3002/api/queue';
const token = 'your-jwt-token';

async function callContract() {
  const response = await axios.post(
    `${API_URL}/jobs/contract-call`,
    {
      contractId: 'CXXXXXXX...',
      functionName: 'transfer',
      parameters: {
        from: 'GXXXXX...',
        to: 'GXXXXX...',
        amount: '1000',
      },
      priority: 2, // NORMAL
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const { jobId, dbId } = response.data.data;
  console.log('Job created:', jobId);

  // Poll for status
  const status = await pollJobStatus(jobId);
  console.log('Job completed:', status);
}

async function pollJobStatus(jobId: string): Promise<any> {
  while (true) {
    const response = await axios.get(`${API_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const job = response.data.data.job;

    if (job.status === 'COMPLETED') {
      return job.result;
    }

    if (job.status === 'FAILED') {
      throw new Error(job.error);
    }

    // Wait 2 seconds before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
```

### Example 2: Urgent Settlement

```typescript
async function processSettlement() {
  const response = await axios.post(
    `${API_URL}/jobs/settlement`,
    {
      contractId: 'CXXXXXXX...',
      functionName: 'settle',
      parameters: {
        batchId: 'batch_123',
        transactions: [...],
        totalAmount: '50000',
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  console.log('Settlement job created with URGENT priority');
  console.log('Job ID:', response.data.data.jobId);
}
```

### Example 3: Batch Operations

```typescript
async function processBatch() {
  const response = await axios.post(
    `${API_URL}/jobs`,
    {
      type: 'BATCH_OPERATION',
      parameters: {
        operations: [
          { type: 'transfer', from: 'A', to: 'B', amount: '100' },
          { type: 'transfer', from: 'B', to: 'C', amount: '50' },
          { type: 'transfer', from: 'C', to: 'D', amount: '25' },
        ],
      },
      priority: 1, // LOW
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  console.log('Batch job created:', response.data.data.jobId);
}
```

### Example 4: Monitor Queue Metrics

```typescript
async function monitorQueue() {
  const response = await axios.get(`${API_URL}/metrics`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const { metrics } = response.data.data;

  console.log('Queue Status:');
  console.log(`  Waiting: ${metrics.queue.waiting}`);
  console.log(`  Active: ${metrics.queue.active}`);
  console.log(`  Completed: ${metrics.queue.completed}`);
  console.log(`  Failed: ${metrics.queue.failed}`);
  console.log(`  Total: ${metrics.queue.total}`);
}
```

## Worker Deployment

### Running the Worker

```bash
# Development
npm run worker:dev

# Production
npm run worker
```

### Multiple Workers

For high throughput, run multiple worker instances:

```bash
# Terminal 1
npm run worker

# Terminal 2
npm run worker

# Terminal 3
npm run worker
```

Workers automatically coordinate through Redis.

### Docker Deployment

```dockerfile
# Dockerfile.worker
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

CMD ["node", "dist/workers/contract-queue.worker.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build: .
    ports:
      - "3002:3002"
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://...
    depends_on:
      - redis

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://...
      - QUEUE_CONCURRENCY=5
    depends_on:
      - redis
    deploy:
      replicas: 3
```

## Configuration

### Environment Variables

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Queue Configuration
QUEUE_CONCURRENCY=5  # Number of concurrent jobs per worker

# Stellar Configuration
STELLAR_NETWORK=TESTNET
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
```

### Custom Job Configuration

Edit `backend/src/config/queue.ts`:

```typescript
export const jobTypeConfigs: Record<string, Partial<JobsOptions>> = {
  MY_CUSTOM_JOB: {
    attempts: 7,
    backoff: {
      type: 'exponential',
      delay: 4000,
    },
    priority: 3,
  },
};
```

## Monitoring

### Queue Dashboard

BullMQ provides a web dashboard for monitoring:

```bash
npm install -g bull-board
bull-board
```

Access at `http://localhost:3000`

### Metrics Endpoint

The `/api/queue/metrics` endpoint provides:
- Queue counts (waiting, active, completed, failed)
- Database statistics
- Job distribution by status

### Logging

All job events are logged:
- Job creation
- Job start
- Job progress
- Job completion
- Job failure

Check logs with:
```bash
tail -f logs/app.log
```

## Best Practices

### 1. Job Design

- **Idempotent**: Jobs should be safe to retry
- **Atomic**: Each job should be a single unit of work
- **Timeout**: Set appropriate timeouts for long-running jobs
- **Progress**: Report progress for better UX

### 2. Error Handling

- **Specific Errors**: Throw specific error messages
- **Retryable vs Non-Retryable**: Distinguish error types
- **Logging**: Log all errors with context
- **Monitoring**: Set up alerts for high failure rates

### 3. Performance

- **Concurrency**: Adjust based on system resources
- **Rate Limiting**: Prevent overwhelming external services
- **Batch Processing**: Group similar operations
- **Cleanup**: Regularly clean old jobs

### 4. Security

- **Authentication**: All endpoints require JWT
- **Authorization**: Users can only access their jobs
- **Input Validation**: Validate all job parameters
- **Rate Limiting**: Prevent abuse

## Troubleshooting

### Jobs Not Processing

**Check:**
1. Worker is running: `ps aux | grep worker`
2. Redis is accessible: `redis-cli ping`
3. Worker logs: `tail -f logs/worker.log`

### High Failure Rate

**Check:**
1. Stellar network status
2. Contract availability
3. Parameter validation
4. Network connectivity

### Slow Processing

**Solutions:**
1. Increase worker concurrency
2. Add more worker instances
3. Optimize job logic
4. Check Redis performance

### Memory Issues

**Solutions:**
1. Clean old jobs regularly
2. Reduce job retention time
3. Limit concurrent jobs
4. Monitor Redis memory

## Future Enhancements

1. **Job Scheduling**: Schedule jobs for future execution
2. **Job Dependencies**: Chain jobs with dependencies
3. **Webhooks**: Notify external systems on job completion
4. **Job Priorities**: Dynamic priority adjustment
5. **Job Cancellation**: Cancel running jobs
6. **Job Pause/Resume**: Pause and resume job processing
7. **Job Metrics**: Detailed performance metrics
8. **Job Visualization**: Real-time job flow visualization

## Support

For issues or questions:
- Check the [API Documentation](http://localhost:3002/api-docs)
- Review worker logs
- Check Redis connectivity
- Create an issue in the repository
