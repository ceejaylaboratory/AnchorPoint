# Testnet Deployment Architecture

## Overview

This document describes the architecture used for AnchorPoint testnet deployment, with a focus on how services interact and how task processing is handled.

## Architecture Components

- **Frontend**: The dashboard user interface.
- **Backend API**: Node.js/TypeScript service that handles authentication, contract interactions, and queue management.
- **Redis**: The queue broker for BullMQ.
- **BullMQ Worker**: Processes queued jobs for contract operations.
- **Database**: Stores job metadata, user state, and application records.
- **Stellar Testnet**: External contract execution and transaction settlement network.

## Logical Flow

```
User / Dashboard
       │
       ▼
Backend API ──▶ Redis (BullMQ)
       │          ▲
       │          │
       ▼          │
  Database       BullMQ Worker
       │          │
       ▼          ▼
Stellar Testnet / Contracts
```

### Sequence

1. The frontend submits requests to the backend API.
2. The backend API validates input and creates BullMQ jobs.
3. Jobs are added to Redis and persisted in the database.
4. The BullMQ worker processes jobs from Redis.
5. The worker executes contract interactions against the Stellar testnet.
6. Results, status updates, and errors are written back to the database.
7. The frontend or API clients query job status as needed.

## Deployment Considerations

- Use persistent Redis storage for job state and retries.
- Deploy the BullMQ worker as a separate process or service from the main backend API.
- Ensure the backend and worker share the same Redis configuration.
- Protect environment variables and avoid exposing secret keys in logs.

## Architecture Diagram

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   Frontend    │     │   Backend     │     │   BullMQ      │
│   Dashboard   │────▶│     API       │────▶│   Worker      │
└───────────────┘     └───────────────┘     └───────────────┘
         │                    │                   │
         │                    │                   │
         ▼                    ▼                   ▼
     User auth           Redis queue          Stellar testnet
         │                    │                   │
         ▼                    │                   ▼
      Session             Job storage         Contract calls
                           / retry
```

## Manual QA

1. Deploy Redis and the backend service.
2. Start the BullMQ worker process.
3. Submit a job through the backend API.
4. Confirm the job is enqueued in Redis and visible in the database.
5. Verify the worker processes the job and updates the job status.
6. Ensure the backend and worker do not log private keys or secret values.
7. Validate the end-to-end flow against the Stellar testnet.