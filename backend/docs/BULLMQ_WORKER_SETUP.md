# BullMQ Worker Setup Guide

## Purpose

This guide explains how to set up and run the BullMQ worker that processes contract queue jobs in the AnchorPoint backend.

## Prerequisites

- Node.js installed
- Redis available and reachable from the backend
- Backend dependencies installed
- Backend built before running compiled worker code

## Environment

The BullMQ worker uses the backend configuration files and environment variables.

Key settings include:
- `REDIS_URL` or equivalent Redis connection values
- Any backend service environment variables required for queue processing

If the repository uses a `.env` file, ensure it contains the correct Redis connection information and other backend runtime settings.

## Setup Steps

1. Install backend dependencies:

```bash
cd backend
npm install
```

2. Build the backend TypeScript sources:

```bash
npm run build
```

3. Start Redis if it is not already running.

4. Start the BullMQ worker for contract queue jobs:

```bash
cd backend
node dist/workers/contract-queue.worker.js
```

### Alternative: Run in development mode

For local development, run the backend and worker in separate terminals using source TypeScript code if the environment supports it.

## Worker Responsibilities

The BullMQ worker processes jobs from Redis, including:
- contract function calls
- settlement tasks
- transaction submits
- batch operations

The worker reports job progress and records results or errors in the backend job store.

## Troubleshooting

- Verify Redis connectivity.
- Confirm the backend build output includes `dist/workers/contract-queue.worker.js`.
- Check logs for BullMQ processing errors.
- Ensure environment variables are set correctly before starting the worker.

## Manual QA

1. Start the backend API and Redis.
2. Add a contract queue job through the backend API or test harness.
3. Start the worker:

```bash
cd backend
node dist/workers/contract-queue.worker.js
```

4. Confirm the job moves from pending to completed or failed.
5. Review the worker logs for any errors.
6. Validate the job result in the backend job status endpoint.