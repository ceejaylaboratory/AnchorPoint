# Implementation Plan: OpenTelemetry Request Tracing

## Overview

Implement end-to-end distributed request tracing for the AnchorPoint backend using the OpenTelemetry Node.js SDK. The implementation is broken into incremental steps: SDK setup, tracing middleware, Prisma extension, Winston log correlation, and utility functions — each wired together before moving to the next.

## Tasks

- [x] 1. Install dependencies and create the tracing module skeleton
  - Install `@opentelemetry/sdk-node`, `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation-express`, `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-ioredis`, `@opentelemetry/context-async-hooks`, `@opentelemetry/semantic-conventions`, and `fast-check` (dev)
  - Create the `backend/src/tracing/` directory with empty placeholder files: `tracing.service.ts`, `tracing.middleware.ts`, `prisma.extension.ts`, `winston-trace.format.ts`, `noop.ts`, `index.ts`
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Implement TracingService with SDK initialization and shutdown
  - [x] 2.1 Implement `tracing.service.ts` — read env vars (`OTEL_ENABLED`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACES_SAMPLER_ARG`), validate sampling ratio (log warning + fallback to 1.0 if out of range), configure `TraceIdRatioBased` sampler, `OTLPTraceExporter`, `BatchSpanProcessor`, `AsyncLocalStorageContextManager`, and auto-instrumentations; call `sdk.start()` inside a try/catch that logs errors and falls back gracefully; register `SIGTERM`/`SIGINT` handlers that call `sdk.shutdown()` with a 5-second timeout
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 9.4, 3.1, 3.3_

  - [ ]\* 2.2 Write property test for SDK resource attributes (Property 1)
    - **Property 1: SDK resource attributes reflect environment configuration**
    - **Validates: Requirements 1.1, 1.2**
    - File: `backend/src/tracing/__tests__/properties/sdk-config.property.test.ts`

  - [ ]\* 2.3 Write property test for out-of-range sampling ratio fallback (Property 17)
    - **Property 17: Out-of-range sampling ratio falls back to 1.0 with a warning**
    - **Validates: Requirements 9.3**
    - File: `backend/src/tracing/__tests__/properties/sdk-config.property.test.ts`

- [x] 3. Implement no-op module and wire OTEL_ENABLED guard
  - [x] 3.1 Implement `noop.ts` — export no-op implementations of `startSpan`, `withSpan`, `getActiveTraceId`, `runWithContext`, `initialize`, and `shutdown` that never throw and return sensible defaults
  - [x] 3.2 Update `index.ts` to export from `noop.ts` when `OTEL_ENABLED=false`, otherwise export from `tracing.service.ts`
  - _Requirements: 1.3, 11.1_

  - [ ]\* 3.3 Write property test for no-op mode safety (Property 20)
    - **Property 20: No-op mode — all utility functions are safe to call when tracing is disabled**
    - **Validates: Requirements 11.1, 1.3**
    - File: `backend/src/tracing/__tests__/properties/sdk-config.property.test.ts`

- [x] 4. Implement tracing middleware
  - [x] 4.1 Implement `tracing.middleware.ts` — extract W3C `traceparent`/`tracestate` via `propagation.extract`; start root span named `HTTP <METHOD> <route_pattern>`; set `http.method`, `http.url`, `http.route`, `http.host`, `http.scheme` attributes; on `res.finish` record `http.status_code`, set span status to `ERROR` for 5xx, end span, and inject `x-trace-id`/`x-span-id` response headers
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]\* 4.2 Write property test for HTTP root span name and attributes (Property 2)
    - **Property 2: HTTP root span has correct name and all required attributes**
    - **Validates: Requirements 2.3, 2.4, 2.5**
    - File: `backend/src/tracing/__tests__/properties/http-middleware.property.test.ts`

  - [ ]\* 4.3 Write property test for W3C traceparent parent context (Property 3)
    - **Property 3: W3C traceparent header is used as parent context**
    - **Validates: Requirements 2.1, 2.2**
    - File: `backend/src/tracing/__tests__/properties/http-middleware.property.test.ts`

  - [ ]\* 4.4 Write property test for 5xx span ERROR status (Property 4)
    - **Property 4: 5xx responses set span status to ERROR**
    - **Validates: Requirements 2.6, 6.4**
    - File: `backend/src/tracing/__tests__/properties/http-middleware.property.test.ts`

  - [ ]\* 4.5 Write property test for trace/span ID response headers (Property 5)
    - **Property 5: Trace and span IDs are injected into response headers**
    - **Validates: Requirements 2.7**
    - File: `backend/src/tracing/__tests__/properties/http-middleware.property.test.ts`

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement span utility functions on TracingService
  - [x] 6.1 Add `startSpan`, `withSpan`, `getActiveTraceId`, and `runWithContext` to `tracing.service.ts` — `withSpan` must end the span exactly once on both resolve and reject, record errors, and set `ERROR` status on rejection; `getActiveTraceId` returns the 32-char hex trace ID or `undefined`
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 3.4_

  - [ ]\* 6.2 Write property test for withSpan lifecycle (Property 18)
    - **Property 18: withSpan ends span and propagates result for any async function**
    - **Validates: Requirements 10.2, 10.3**
    - File: `backend/src/tracing/__tests__/properties/span-utilities.property.test.ts`

  - [ ]\* 6.3 Write property test for getActiveTraceId (Property 19)
    - **Property 19: getActiveTraceId returns trace ID within span, undefined outside**
    - **Validates: Requirements 10.4**
    - File: `backend/src/tracing/__tests__/properties/span-utilities.property.test.ts`

  - [ ]\* 6.4 Write property test for async context propagation (Property 6)
    - **Property 6: Async context propagation preserves parent-child span relationships**
    - **Validates: Requirements 3.1, 3.2**
    - File: `backend/src/tracing/__tests__/properties/async-propagation.property.test.ts`

  - [ ]\* 6.5 Write property test for runWithContext (Property 7)
    - **Property 7: runWithContext propagates captured context to callbacks**
    - **Validates: Requirements 3.4**
    - File: `backend/src/tracing/__tests__/properties/async-propagation.property.test.ts`

- [x] 7. Implement Prisma tracing extension
  - [x] 7.1 Implement `prisma.extension.ts` — use `$extends` to wrap every query operation in a child span named `prisma:<Model>.<operation>`; set `db.system=postgresql`, `db.operation`, `db.sql.table` attributes; on error set span status `ERROR`, record error event, re-throw; never record query parameter values in attributes
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]\* 7.2 Write property test for Prisma span name and attributes (Property 8)
    - **Property 8: Prisma spans have correct name and required attributes**
    - **Validates: Requirements 4.1, 4.2**
    - File: `backend/src/tracing/__tests__/properties/prisma-extension.property.test.ts`

  - [ ]\* 7.3 Write property test for Prisma error spans (Property 9)
    - **Property 9: Prisma errors produce ERROR spans with error events**
    - **Validates: Requirements 4.3**
    - File: `backend/src/tracing/__tests__/properties/prisma-extension.property.test.ts`

  - [ ]\* 7.4 Write property test for Prisma parameter data exclusion (Property 10)
    - **Property 10: Prisma span attributes contain no query parameter values**
    - **Validates: Requirements 4.4**
    - File: `backend/src/tracing/__tests__/properties/prisma-extension.property.test.ts`

- [x] 8. Implement Winston trace correlation format
  - [x] 8.1 Implement `winston-trace.format.ts` — create a custom Winston format using `winston.format((info) => ...)` that calls `trace.getActiveSpan()`, checks the span is valid and sampled, and injects `traceId` and `spanId` into the log info object; omit both fields entirely when no active span exists
  - [x] 8.2 Update `backend/src/utils/logger.ts` to include `traceContextFormat()` in the format chain, preserving all existing transports and format behavior; add JSON format when `NODE_ENV=production`
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]\* 8.3 Write property test for log entries within active spans (Property 15)
    - **Property 15: Log entries within active spans contain traceId and spanId**
    - **Validates: Requirements 7.1**
    - File: `backend/src/tracing/__tests__/properties/winston-format.property.test.ts`

  - [ ]\* 8.4 Write property test for log entries outside active spans (Property 16)
    - **Property 16: Log entries outside active spans omit traceId and spanId**
    - **Validates: Requirements 7.2**
    - File: `backend/src/tracing/__tests__/properties/winston-format.property.test.ts`

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Wire tracing into the application entry point and Prisma client
  - [x] 10.1 Update `backend/src/index.ts` to import `tracing.ts` (or `index.ts` from the tracing module) as the very first import, before Express, Prisma, or any middleware
  - [x] 10.2 Update the Prisma client instantiation (wherever `new PrismaClient()` is called) to wrap it with `withTracingExtension(prisma)` from `prisma.extension.ts`
  - [x] 10.3 Register `tracingMiddleware` in the Express app before all other middleware
  - _Requirements: 1.4, 4.1, 2.1_

- [x] 11. Write unit tests for SDK initialization and graceful shutdown
  - [x] 11.1 Write unit tests in `backend/src/tracing/__tests__/tracing.service.test.ts` covering: `OTEL_ENABLED=false` skips init, SDK init failure logs error and continues, `SIGTERM`/`SIGINT` triggers `sdk.shutdown()`, and no-op mode returns correct defaults
  - _Requirements: 1.3, 1.5, 8.5, 11.1_

- [x] 12. Write unit tests for Redis instrumentation spans
  - [x] 12.1 Write unit tests using a mock ioredis client to verify span name, attributes, and error handling for Redis commands
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]\* 12.2 Write property test for Redis span name and attributes (Property 11)
    - **Property 11: Redis spans have correct name and required attributes**
    - **Validates: Requirements 5.1, 5.2**
    - File: `backend/src/tracing/__tests__/properties/redis-instrumentation.property.test.ts`

  - [ ]\* 12.3 Write property test for Redis error spans (Property 12)
    - **Property 12: Redis errors produce ERROR spans with error events**
    - **Validates: Requirements 5.3**
    - File: `backend/src/tracing/__tests__/properties/redis-instrumentation.property.test.ts`

  - [ ]\* 12.4 Write property test for Redis key data exclusion (Property 13)
    - **Property 13: Redis span attributes contain no key values**
    - **Validates: Requirements 5.4**
    - File: `backend/src/tracing/__tests__/properties/redis-instrumentation.property.test.ts`

- [x] 13. Write unit tests for outbound HTTP instrumentation
  - [x] 13.1 Write unit tests verifying that outbound HTTP requests carry `traceparent`/`tracestate` headers and produce child spans with correct attributes
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]\* 13.2 Write property test for outbound HTTP spans and header injection (Property 14)
    - **Property 14: Outbound HTTP spans have correct name and attributes, and inject propagation headers**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - File: `backend/src/tracing/__tests__/properties/outbound-http.property.test.ts`

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `InMemorySpanExporter` from `@opentelemetry/sdk-trace-base` — no real Jaeger instance needed
- Each property test must include the comment tag `// Feature: opentelemetry-request-tracing, Property <N>: <property_text>`
- Each property test must set `numRuns: 100` explicitly
- The tracing module import in `index.ts` must be the absolute first import to ensure all auto-instrumentation patches are applied before any other module loads
