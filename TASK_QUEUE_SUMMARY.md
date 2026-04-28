# Distributed Task Queue for Contract Interactions - Implementation Summary

## Issue #114

Branch: `feature/distributed-task-queue-114`

## Overview

Implemented a comprehensive distributed task queue system using BullMQ and Redis for handling long-running smart contract interactions on the Stellar blockchain. The system provides automatic retry logic, job prioritization, and transparent status tracking.

## What Was Created

### 1. Queue Configuration (`backend/src/config/queue.ts`)
- BullMQ queue and worker configuration
- Job type configurations with retry strategies
- Priority levels (LOW, NORMAL, HIGH, URGENT)
- Error-specific retry strategies
- Queue connection settings

### 2. Queue Service (`backend/src/services/contract-queue.service.ts`)
Comprehensive service for managing the task queue:
- **Job Management**: Create, retrieve, retry, cancel jobs
- **Priority Handling**: Support for 4 priority levels
- **Status Tracking**: Real-time job status updates
- **Database Integration**: Persist job metadata in Prisma
- **Metrics**: Queue statistics and performance metrics
- **Cleanup**: Automatic cleanup of old jobs

### 3. Worker Process (`backend/src/workers/contract-queue.worker.ts`)
Standalone worker process that processes jobs:
- **Job Processors**: Handlers for different job types
- **Retry Logic**: Smart retry with exponential backoff
- **Error Handling**: Specific handling for Stellar errors
- **Progress Tracking**: Report job progress
- **Event Listeners**: Monitor job lifecycle events

### 4. API Layer

#### Controller (`backend/src/api/controllers/queue.controller.ts`)
HTTP endpoints for queue management.

#### Routes (`backend/src/api/routes/queue.route.ts`)
RESTful API with Swagger documentation:
- `POST /api/queue/jobs` - Create job
- `POST /api/queue/jobs/settlement` - Create urgent settlement job
- `POST /api/queue/jobs/contract-call` - Create contract call job
- `GET /api/queue/jobs/:jobId` - Get job status
- `GET /api/queue/jobs/status/:status` - Get jobs by status
- `GET /api/queue/my-jobs` - Get user's jobs
- `POST /api/queue/jobs/:jobId/retry` - Retry failed job
- `POST /api/queue/jobs/:jobId/cancel` - Cancel job
- `GET /api/queue/metrics` - Get queue metrics
- `POST /api/queue/clean` - Clean old jobs

### 5. Database Schema

#### ContractJob Model
```prisma
model ContractJob {
  id              String      @id @default(uuid())
  jobId           String      @unique // BullMQ job ID
  type            String      // Job type
  priority        JobPriority @default(NORMAL)
  status          JobStatus   @default(PENDING)
  contractId      String?
  functionName    String?
  parameters      Json?
  result          Json?
  error           String?
  attempts        Int         @default(0)
  maxAttempts     Int         @default(3)
  createdBy       String?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt
  startedAt       DateTime?
  completedAt     DateTime?
  failedAt        DateTime?
  metadata        Json?
}
```

#### Enums
- **JobStatus**: PENDING, ACTIVE, COMPLETED, FAILED, DELAYED, RETRYING
- **JobPriority**: LOW, NORMAL, HIGH, URGENT

### 6. Documentation (`backend/docs/TASK_QUEUE.md`)
Comprehensive documentation covering:
- Feature overview
- Architecture details
- API endpoints
- Error handling strategies
- Usage examples
- Worker deployment
- Configuration options
- Monitoring and troubleshooting
- Best practices

## Key Features

### ✅ Retry Logic
- **Automatic Retries**: Failed jobs retry with exponential backoff
- **Error-Specific Strategies**: Different retry logic for different errors
  - `too_early`: 10 attempts, 5s delay, 1.5x backoff
  - `transaction_failed`: 5 attempts, 3s delay, 2x backoff
  - `insufficient_balance`: 3 attempts, 10s delay, fixed
  - `network_error`: 7 attempts, 2s delay, 2x backoff
- **Configurable Attempts**: Set max attempts per job type
- **Smart Backoff**: Exponential or fixed delay strategies

### ✅ Job Prioritization
- **Four Priority Levels**: LOW (1), NORMAL (2), HIGH (3), URGENT (4)
- **Priority Queue**: Higher priority jobs processed first
- **Settlement Priority**: Urgent settlement tasks (priority 4)
- **Custom Priorities**: Set priority per job

### ✅ Transparent Status Tracking
- **Real-time Status**: Track job progress in real-time
- **Database Persistence**: Job history stored in database
- **Progress Updates**: Jobs report 0-100% progress
- **Detailed Errors**: Error messages and stack traces
- **Lifecycle Events**: Track created, started, completed, failed times

### ✅ Job Types

#### CONTRACT_CALL
- Attempts: 5
- Backoff: Exponential (3s)
- Priority: NORMAL

#### CONTRACT_DEPLOY
- Attempts: 3
- Backoff: Exponential (5s)
- Priority: HIGH

#### SETTLEMENT
- Attempts: 10
- Backoff: Exponential (2s)
- Priority: URGENT

#### TRANSACTION_SUBMIT
- Attempts: 5
- Backoff: Exponential (2s)
- Priority: HIGH

#### BATCH_OPERATION
- Attempts: 3
- Backoff: Fixed (10s)
- Priority: LOW

## Architecture

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   API       │─────▶│   Queue     │─────▶│   Worker    │
│ Controller  │      │  Service    │      │  Process    │
└─────────────┘      └─────────────┘      └─────────────┘
       │                    │                     │
       ▼                    ▼                     ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Database   │      │    Redis    │      │   Stellar   │
│  (Prisma)   │      │   (BullMQ)  │      │   Network   │
└─────────────┘      └─────────────┘      └─────────────┘
```

## Usage Examples

### Create Contract Call Job

```typescript
const response = await fetch('/api/queue/jobs/contract-call', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    contractId: 'CXXXXXXX...',
    functionName: 'transfer',
    parameters: {
      from: 'GXXXXX...',
      to: 'GXXXXX...',
      amount: '1000',
    },
    priority: 2, // NORMAL
  }),
});

const { jobId } = await response.json();
```

### Create Urgent Settlement Job

```typescript
const response = await fetch('/api/queue/jobs/settlement', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    contractId: 'CXXXXXXX...',
    functionName: 'settle',
    parameters: {
      batchId: 'batch_123',
      amount: '50000',
    },
  }),
});
```

### Poll Job Status

```typescript
async function pollJobStatus(jobId: string) {
  while (true) {
    const response = await fetch(`/api/queue/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    const { job } = await response.json();
    
    if (job.status === 'COMPLETED') {
      return job.result;
    }
    
    if (job.status === 'FAILED') {
      throw new Error(job.error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
```

### Get Queue Metrics

```typescript
const response = await fetch('/api/queue/metrics', {
  headers: { 'Authorization': `Bearer ${token}` },
});

const { metrics } = await response.json();
console.log('Waiting:', metrics.queue.waiting);
console.log('Active:', metrics.queue.active);
console.log('Completed:', metrics.queue.completed);
```

## Files Created/Modified

### New Files (8)
1. `backend/src/config/queue.ts` - Queue configuration
2. `backend/src/services/contract-queue.service.ts` - Queue service
3. `backend/src/workers/contract-queue.worker.ts` - Worker process
4. `backend/src/api/controllers/queue.controller.ts` - HTTP controller
5. `backend/src/api/routes/queue.route.ts` - API routes
6. `backend/docs/TASK_QUEUE.md` - Documentation
7. `TASK_QUEUE_SUMMARY.md` - This summary

### Modified Files (3)
1. `backend/package.json` - Added BullMQ dependency and worker scripts
2. `backend/prisma/schema.prisma` - Added ContractJob model and enums
3. `backend/src/index.ts` - Registered queue routes

## Next Steps

### To Use This Feature:

1. **Install Dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Start Redis**
   ```bash
   docker run -d -p 6379:6379 redis:7-alpine
   # or
   redis-server
   ```

3. **Run Database Migration**
   ```bash
   npx prisma generate
   npx prisma migrate dev --name add_contract_job_model
   ```

4. **Start API Server**
   ```bash
   npm run dev
   ```

5. **Start Worker Process**
   ```bash
   # In a separate terminal
   npm run worker:dev
   ```

6. **Test the Queue**
   - Access API docs: `http://localhost:3002/api-docs`
   - Look for "Queue" tag in Swagger UI
   - Create a test job
   - Monitor worker logs

## Worker Deployment

### Development
```bash
npm run worker:dev
```

### Production
```bash
npm run worker
```

### Multiple Workers (High Throughput)
```bash
# Terminal 1
npm run worker

# Terminal 2
npm run worker

# Terminal 3
npm run worker
```

### Docker Deployment
```yaml
services:
  worker:
    build: .
    command: npm run worker
    environment:
      - REDIS_URL=redis://redis:6379
      - QUEUE_CONCURRENCY=5
    deploy:
      replicas: 3
```

## Benefits

### 1. Reliability
- Automatic retries for transient failures
- Persistent job storage
- Graceful error handling
- Worker crash recovery

### 2. Scalability
- Horizontal scaling with multiple workers
- Redis-based coordination
- Configurable concurrency
- Rate limiting

### 3. Observability
- Real-time status tracking
- Detailed error messages
- Progress reporting
- Queue metrics

### 4. Performance
- Asynchronous processing
- Priority-based execution
- Batch operations
- Efficient resource usage

## Monitoring

### Queue Metrics
- Waiting jobs count
- Active jobs count
- Completed jobs count
- Failed jobs count
- Delayed jobs count

### Job Metrics
- Attempts made
- Processing time
- Success rate
- Error distribution

### Worker Metrics
- Concurrency level
- Jobs per second
- Memory usage
- CPU usage

## Error Handling

### Retryable Errors
- `too_early` - Stellar sequence number issue
- `transaction_failed` - Transaction failed on network
- `insufficient_balance` - Account balance too low
- `network_error` - Network connectivity issues

### Non-Retryable Errors
- Invalid parameters
- Contract not found
- Unauthorized access
- Invalid signature

## Security

- **Authentication**: All endpoints require JWT
- **Authorization**: Users can only access their jobs
- **Input Validation**: Zod schema validation
- **Rate Limiting**: Prevent queue flooding

## Performance Considerations

### Database Indexes
- Job ID (unique lookups)
- Job type (filtering)
- Job status (filtering)
- Priority (sorting)
- Created by (user queries)
- Created at (time-based queries)

### Redis Configuration
- Connection pooling
- Retry strategy
- Max retries per request
- Command timeout

### Worker Configuration
- Concurrency: 5 jobs per worker
- Rate limit: 10 jobs per second
- Backoff strategy: Exponential
- Max job time: 5 minutes

## Future Enhancements

1. **Job Scheduling**: Schedule jobs for future execution
2. **Job Dependencies**: Chain jobs with dependencies
3. **Webhooks**: Notify external systems on completion
4. **Dynamic Priorities**: Adjust priority based on conditions
5. **Job Pause/Resume**: Pause and resume processing
6. **Advanced Metrics**: Detailed performance analytics
7. **Job Visualization**: Real-time flow visualization
8. **Bulk Operations**: Create multiple jobs at once

## Support

For issues or questions:
- Review the [Documentation](backend/docs/TASK_QUEUE.md)
- Check API docs at `/api-docs`
- Review worker logs
- Check Redis connectivity
- Create an issue in the repository

## Conclusion

This implementation provides a production-ready distributed task queue system with:
- Robust retry logic for handling transient failures
- Flexible job prioritization for urgent tasks
- Transparent status tracking for frontend integration
- Comprehensive error handling
- Scalable architecture
- Full documentation and examples

The system is ready for handling long-running smart contract interactions on the Stellar blockchain with reliability and performance.
