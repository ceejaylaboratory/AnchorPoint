# Implementation Plan: ELK Logging & Analytics

## Overview

Refactor the Winston logger to emit structured JSON, add a Logstash TCP transport with Dead Letter Queue, introduce request-log and sampling middleware, and provision Logstash/Kibana/Elasticsearch Watcher configuration artifacts.

## Tasks

- [x] 1. Create `structuredJsonFormat` Winston format
  - Create `backend/src/utils/log-format.ts` exporting `structuredJsonFormat()`
  - Enforce ISO 8601 timestamp, inject `service` and `environment` from `defaultMeta` / `process.env.NODE_ENV`
  - Serialise `Error` objects to top-level `errorMessage` and `errorStack` fields; remove any top-level `error` key
  - Delegate `traceId`/`spanId` injection to the existing `traceContextFormat()` called earlier in the chain; omit both keys when absent
  - _Requirements: 1.1, 1.2, 1.3, 1.6_

  - [x]\* 1.1 Write property test for structured log fields always present (P1)
    - **Property 1: Structured log fields are always present**
    - **Validates: Requirements 1.1, 1.6**

  - [x]\* 1.2 Write property test for trace fields absent when no active span (P2)
    - **Property 2: Trace fields are absent when no active span**
    - **Validates: Requirements 1.2**

  - [x]\* 1.3 Write property test for error serialisation round trip (P3)
    - **Property 3: Error serialisation round trip**
    - **Validates: Requirements 1.3**

- [x] 2. Implement `LogstashTransport` Winston transport
  - Create `backend/src/utils/logstash.transport.ts` with class `LogstashTransport extends winston.Transport`
  - Open a TCP socket to `host:port`; write newline-delimited JSON frames
  - Implement in-memory circular Dead Letter Queue capped at `maxBufferSize` (default 1000)
  - On socket error: buffer entries, schedule reconnect with configurable interval (default 5000ms), emit `console.warn` when buffer is full with drop count
  - On reconnect: flush DLQ in FIFO order before accepting new entries
  - `log()` must return immediately (non-blocking); must never throw synchronously
  - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 9.2_

  - [x]\* 2.1 Write property test for DLQ FIFO flush order (P8)
    - **Property 8: DLQ preserves FIFO order on flush**
    - **Validates: Requirements 2.4**

  - [x]\* 2.2 Write property test for DLQ capacity cap drops oldest entries (P9)
    - **Property 9: DLQ capacity cap drops oldest entries**
    - **Validates: Requirements 2.3, 2.6**

- [x] 3. Implement `samplingConfig` singleton
  - Create `backend/src/utils/sampling-config.ts` exporting `loadSamplingConfig()` and `SamplingConfig` interface
  - Parse `LOG_SAMPLE_ROUTES` JSON at startup; emit `console.warn` on invalid JSON and return ratio `1.0` for all routes
  - `getRatio(method, route)` returns the configured ratio or `1.0` for unmatched routes
  - _Requirements: 8.1, 8.3_

  - [ ]\* 3.1 Write property test for invalid sampling config fallback (P7)
    - **Property 7: Whitespace/invalid sampling config falls back to full logging**
    - **Validates: Requirements 8.3**

- [x] 4. Implement `requestLogMiddleware`
  - Create `backend/src/api/middleware/request-log.middleware.ts`
  - Record `Date.now()` at request entry; attach `requestId` to `res.locals` from `x-request-id` header or `crypto.randomUUID()`
  - On `res.on('finish')`: compute `durationMs`, select log level by status code (5xx→error, 4xx→warn, else→info), apply sampling via `samplingConfig`, emit structured log entry with `httpMethod`, `httpRoute`, `httpStatusCode`, `durationMs`, `requestId`
  - _Requirements: 1.4, 1.5, 7.1, 7.2, 7.3, 7.4, 8.2, 8.4_

  - [ ]\* 4.1 Write property test for request log entry contains required HTTP fields (P4)
    - **Property 4: Request log entry contains required HTTP fields**
    - **Validates: Requirements 1.4, 1.5, 7.1, 7.2**

  - [ ]\* 4.2 Write property test for log level reflects HTTP status code (P5)
    - **Property 5: Log level reflects HTTP status code**
    - **Validates: Requirements 7.3, 7.4**

  - [ ]\* 4.3 Write property test for sampling ratio convergence (P6)
    - **Property 6: Sampling ratio is respected**
    - **Validates: Requirements 8.2**

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Refactor `backend/src/utils/logger.ts`
  - Replace current `baseFormat` with `structuredJsonFormat()` in all environments
  - Conditionally add `LogstashTransport` when `LOGSTASH_HOST` is set (skip when absent, per Requirement 2.2)
  - Apply file transport rules: omit file transports in production when `LOGSTASH_HOST` is set; retain file transports in production when `LOGSTASH_HOST` is absent and emit startup warning; omit file transports in all non-production environments
  - Emit startup warning when neither `ALERT_WEBHOOK_URL` nor `ALERT_EMAIL_RECIPIENTS` is configured
  - _Requirements: 2.2, 4.1, 4.2, 4.3, 6.8, 9.1, 9.4_

  - [x]\* 6.1 Write property test for no file transports in production with ELK configured (P10)
    - **Property 10: File transports absent in production with ELK configured**
    - **Validates: Requirements 4.1**

  - [x]\* 6.2 Write property test for no file transports outside production (P11)
    - **Property 11: File transports absent outside production**
    - **Validates: Requirements 4.3**

- [x] 7. Register `requestLogMiddleware` in the Express app
  - Mount `requestLogMiddleware` early in the middleware chain in `backend/src/app.ts` (or equivalent entry point), before route handlers
  - Ensure `requestId` is available on `res.locals` for downstream middleware and route handlers
  - _Requirements: 1.4, 7.1_

- [x] 8. Create Logstash pipeline configuration
  - Create `infra/logstash/pipeline.conf`
  - Configure TCP input with JSON codec on the Logstash port
  - Add field type coercions: `level` → keyword, `traceId`/`spanId` → keyword, `timestamp` → date (ISO 8601)
  - Configure Elasticsearch output with date-partitioned index `anchorpoint-logs-%{+YYYY.MM.dd}`
  - Configure dead-letter output to `anchorpoint-logs-dlq` on indexing failure
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 9. Create Kibana saved-objects dashboard
  - Create `infra/kibana/dashboard.ndjson`
  - Include index pattern for `anchorpoint-logs-*`
  - Add panel: Error_Rate time-series chart (5-minute rolling window, configurable)
  - Add panel: API_Latency percentiles (p50, p95, p99) time-series chart sourced from `durationMs`
  - Add panel: log volume by `level` stacked bar chart over time
  - Add panel: filterable log table (most recent 100 entries, columns: `timestamp`, `level`, `message`, `traceId`, `httpRoute`)
  - Configure `traceId` field formatter as URL link to `${JAEGER_UI_URL}/trace/{value}`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 10. Create Elasticsearch Watcher alert rules
  - Create `infra/elasticsearch/watchers/error-rate-watcher.json`
    - Evaluate 5-minute rolling Error_Rate every 1 minute; fire `critical` alert when rate exceeds 5%
    - Include webhook action driven by `ALERT_WEBHOOK_URL` and email action driven by `ALERT_EMAIL_RECIPIENTS`
    - Include recovery notification when condition resolves
  - Create `infra/elasticsearch/watchers/latency-watcher.json`
    - Evaluate p99 API_Latency every 1 minute over 5-minute window; fire `warning` at >2000ms, `critical` at >5000ms
    - Include same webhook and email actions; include recovery notification
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests live in `backend/src/utils/__tests__/elk-logging.property.test.ts` using fast-check (minimum 100 iterations each)
- Each property test must include the comment `// Feature: elk-logging-analytics, Property N: <property text>`
- Tasks 8–10 produce infrastructure config artifacts (not TypeScript) and have no associated property tests
- Checkpoints at tasks 5 and 11 validate incremental progress before wiring and infra work
