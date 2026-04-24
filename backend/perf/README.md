# Backend Performance Benchmarks

This folder contains a high-concurrency benchmarking harness for core backend endpoints.

## Goals

- Establish baseline performance metrics for future PRs.
- Identify bottlenecks in Postgres/SQLite interactions (Prisma) and Redis usage.
- Detect Node.js event-loop pressure under load.

## Prerequisites

- Backend running locally (see `../README.md`).
- Optional: Docker Compose (starts backend + Redis).

## Run

From `backend/`:

```bash
npm run bench
```

### Environment variables

- `BASE_URL` (required if `BENCH_BASE_URL` is not set)
- `BENCH_BASE_URL` (default: `BASE_URL`)
- `BENCH_CONNECTIONS` (default: `100`)
- `BENCH_DURATION_SECONDS` (default: `20`)
- `BENCH_PIPELINING` (default: `1`)
- `BENCH_TIMEOUT_SECONDS` (default: `30`)
- `BENCH_ONLY` (optional)
  - `sep38_price_get`
  - `sep6_deposit`
  - `sep6_withdraw`

## Observability

While running benchmarks, scrape:

- `GET /metrics` (Prometheus)
- `GET /metrics/json` (debug)

Key metrics:

- `http_request_duration_seconds` (end-to-end latency)
- `db_query_duration_seconds` (Prisma query durations)
- `nodejs_event_loop_lag_seconds` (event-loop lag under load)
