# Requirements Document

## Introduction

This feature adds end-to-end distributed request tracing to the AnchorPoint backend (Node.js/TypeScript/Express) using OpenTelemetry. Every inbound HTTP request receives a unique trace ID that propagates through async tasks, Prisma database calls, Redis operations, and outbound HTTP calls. Traces are exported to Jaeger (for distributed tracing visualization) and correlated with existing Winston log entries. The existing Prometheus metrics pipeline (metrics.middleware.ts, metrics.service.ts) is preserved and unaffected.

## Glossary

- **Tracer**: The OpenTelemetry SDK component responsible for creating and managing spans.
- **Span**: A single named, timed operation within a trace representing a unit of work.
- **Trace**: A directed acyclic graph of spans representing the full lifecycle of a request.
- **Trace_ID**: A 128-bit identifier that uniquely identifies a trace across all services.
- **Span_ID**: A 64-bit identifier that uniquely identifies a single span within a trace.
- **Context_Propagation**: The mechanism by which trace context (Trace_ID, Span_ID) is passed across process and async boundaries.
- **W3C_TraceContext**: The W3C Trace Context standard (traceparent/tracestate headers) used for inter-service context propagation.
- **Tracing_Middleware**: The Express middleware responsible for extracting incoming trace context and starting the root span for each HTTP request.
- **Async_Context**: Node.js AsyncLocalStorage used to carry the active OpenTelemetry context across asynchronous boundaries (Promises, callbacks, async/await).
- **Jaeger_Exporter**: The OTLP/gRPC or HTTP exporter that sends completed spans to a Jaeger backend.
- **Instrumentation**: Auto-instrumentation libraries that wrap existing modules (Express, Prisma, Redis, HTTP) to emit spans automatically.
- **Logger**: The existing Winston logger instance defined in `backend/src/utils/logger.ts`.
- **Tracing_Service**: The singleton service responsible for initializing the OpenTelemetry SDK and exposing helper utilities.
- **SDK**: The OpenTelemetry Node.js SDK (`@opentelemetry/sdk-node`).

## Requirements

### Requirement 1: SDK Initialization

**User Story:** As a platform engineer, I want the OpenTelemetry SDK to be initialized before any other application code runs, so that all instrumentation is active from the first request.

#### Acceptance Criteria

1. THE Tracing_Service SHALL initialize the SDK with a service name read from the `OTEL_SERVICE_NAME` environment variable, defaulting to `anchorpoint-backend`.
2. THE Tracing_Service SHALL initialize the SDK with a service version read from the `OTEL_SERVICE_VERSION` environment variable, defaulting to `1.0.0`.
3. WHEN the `OTEL_ENABLED` environment variable is set to `false`, THE Tracing_Service SHALL skip SDK initialization and emit no spans.
4. THE Tracing_Service SHALL be imported and initialized in `backend/src/index.ts` before any Express middleware or route registration.
5. IF the SDK fails to initialize, THEN THE Tracing_Service SHALL log the error via the Logger and allow the application to continue without tracing.

---

### Requirement 2: HTTP Request Tracing

**User Story:** As a platform engineer, I want every inbound HTTP request to automatically produce a root span, so that I can trace the full lifecycle of each request.

#### Acceptance Criteria

1. WHEN an HTTP request is received, THE Tracing_Middleware SHALL extract W3C_TraceContext headers (`traceparent`, `tracestate`) and use them as the parent context if present.
2. WHEN an HTTP request is received and no W3C_TraceContext headers are present, THE Tracing_Middleware SHALL create a new root span with a freshly generated Trace_ID.
3. THE Tracing_Middleware SHALL set the span name to the pattern `HTTP <METHOD> <route_pattern>` (e.g., `HTTP GET /api/transactions/:id`).
4. THE Tracing_Middleware SHALL record the following span attributes: `http.method`, `http.url`, `http.route`, `http.host`, `http.scheme`.
5. WHEN the HTTP response is sent, THE Tracing_Middleware SHALL record `http.status_code` on the span and end the span.
6. IF the response status code is 5xx, THEN THE Tracing_Middleware SHALL set the span status to `ERROR`.
7. THE Tracing_Middleware SHALL attach the active Trace_ID and Span_ID to the response headers as `x-trace-id` and `x-span-id` respectively.

---

### Requirement 3: Context Propagation Through Async Tasks

**User Story:** As a platform engineer, I want trace context to be preserved across all asynchronous operations, so that child spans are correctly linked to their parent request span.

#### Acceptance Criteria

1. THE Tracing_Service SHALL use Node.js `AsyncLocalStorage` via the OpenTelemetry `AsyncLocalStorageContextManager` to propagate context across `async/await`, Promises, and callbacks.
2. WHEN an async operation is started within an active span, THE SDK SHALL automatically associate the child span with the correct parent Trace_ID and Span_ID.
3. THE Tracing_Service SHALL register the `AsyncLocalStorageContextManager` before any instrumentation libraries are loaded.
4. WHEN a background job or queued task is started from within a request context, THE Tracing_Service SHALL provide a utility function to run the task within the captured context.

---

### Requirement 4: Database Instrumentation (Prisma)

**User Story:** As a platform engineer, I want Prisma database queries to produce child spans, so that I can identify slow queries within a trace.

#### Acceptance Criteria

1. WHEN a Prisma query is executed within an active trace context, THE Instrumentation SHALL create a child span with the name `prisma:<model>.<operation>` (e.g., `prisma:User.findMany`).
2. THE Instrumentation SHALL record the following attributes on each Prisma span: `db.system` (value: `postgresql`), `db.operation`, `db.sql.table`.
3. IF a Prisma query throws an error, THEN THE Instrumentation SHALL set the span status to `ERROR` and record the error message as a span event.
4. THE Instrumentation SHALL not record raw SQL query parameters in span attributes to avoid leaking sensitive data.

---

### Requirement 5: Redis Instrumentation

**User Story:** As a platform engineer, I want Redis operations to produce child spans, so that I can observe cache performance within a trace.

#### Acceptance Criteria

1. WHEN a Redis command is executed within an active trace context, THE Instrumentation SHALL create a child span with the name `redis <COMMAND>` (e.g., `redis GET`).
2. THE Instrumentation SHALL record the following attributes on each Redis span: `db.system` (value: `redis`), `db.operation`, `net.peer.name`, `net.peer.port`.
3. IF a Redis command fails, THEN THE Instrumentation SHALL set the span status to `ERROR` and record the error message as a span event.
4. THE Instrumentation SHALL not record Redis key values in span attributes to avoid leaking sensitive data.

---

### Requirement 6: Outbound HTTP Instrumentation

**User Story:** As a platform engineer, I want outbound HTTP calls made by the backend to carry W3C_TraceContext headers, so that traces can be correlated across downstream services.

#### Acceptance Criteria

1. WHEN the backend makes an outbound HTTP request within an active trace context, THE Instrumentation SHALL inject W3C_TraceContext headers (`traceparent`, `tracestate`) into the outbound request.
2. THE Instrumentation SHALL create a child span for each outbound HTTP request with the name `HTTP <METHOD> <host>`.
3. THE Instrumentation SHALL record `http.method`, `http.url`, `http.status_code` as span attributes on the outbound span.
4. IF the outbound HTTP request fails or returns a 5xx status, THEN THE Instrumentation SHALL set the span status to `ERROR`.

---

### Requirement 7: Winston Log Correlation

**User Story:** As a platform engineer, I want Winston log entries to include the active Trace_ID and Span_ID, so that I can correlate logs with traces in Jaeger.

#### Acceptance Criteria

1. THE Logger SHALL be augmented with a Winston format that reads the active OpenTelemetry context and injects `traceId` and `spanId` fields into every log entry produced within an active span.
2. WHEN a log entry is produced outside of an active span, THE Logger SHALL omit the `traceId` and `spanId` fields rather than emitting empty or null values.
3. THE Logger SHALL preserve all existing log fields, transports, and format behavior defined in `backend/src/utils/logger.ts`.
4. THE Logger SHALL emit log entries in JSON format when `NODE_ENV` is `production` to enable structured log ingestion.

---

### Requirement 8: Jaeger Export

**User Story:** As a platform engineer, I want completed spans to be exported to Jaeger, so that I can visualize distributed traces.

#### Acceptance Criteria

1. THE Tracing_Service SHALL export spans to a Jaeger-compatible OTLP endpoint configured via the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable, defaulting to `http://localhost:4318/v1/traces`.
2. WHEN `OTEL_EXPORTER_OTLP_ENDPOINT` is set, THE Tracing_Service SHALL use the OTLP/HTTP exporter to send spans to that endpoint.
3. THE Tracing_Service SHALL use a `BatchSpanProcessor` to buffer and export spans asynchronously, avoiding blocking the request path.
4. IF the Jaeger endpoint is unreachable, THEN THE Tracing_Service SHALL log a warning via the Logger and continue processing requests without dropping spans from the buffer until the buffer limit is reached.
5. WHEN the application receives a shutdown signal (SIGTERM, SIGINT), THE Tracing_Service SHALL flush all buffered spans before the process exits.

---

### Requirement 9: Sampling Configuration

**User Story:** As a platform engineer, I want to control the trace sampling rate, so that I can balance observability coverage against performance overhead in production.

#### Acceptance Criteria

1. THE Tracing_Service SHALL read the sampling ratio from the `OTEL_TRACES_SAMPLER_ARG` environment variable as a float between `0.0` and `1.0`, defaulting to `1.0` (sample all traces).
2. WHEN `OTEL_TRACES_SAMPLER_ARG` is set to `0.0`, THE Tracing_Service SHALL not export any spans.
3. WHEN `OTEL_TRACES_SAMPLER_ARG` is set to a value outside the range `[0.0, 1.0]`, THE Tracing_Service SHALL log a warning and fall back to `1.0`.
4. THE Tracing_Service SHALL use a `TraceIdRatioBased` sampler so that sampling decisions are consistent across services sharing the same Trace_ID.

---

### Requirement 10: Tracing Span Utilities

**User Story:** As a backend developer, I want a utility API for creating custom spans, so that I can instrument application-specific business logic without coupling to the OpenTelemetry SDK directly.

#### Acceptance Criteria

1. THE Tracing_Service SHALL expose a `startSpan(name: string, attributes?: SpanAttributes)` function that creates and returns an active child span within the current context.
2. THE Tracing_Service SHALL expose a `withSpan<T>(name: string, fn: () => Promise<T>)` function that wraps an async function in a new span, ends the span when the function resolves or rejects, and returns the result.
3. WHEN the wrapped function in `withSpan` throws an error, THE Tracing_Service SHALL record the error on the span, set the span status to `ERROR`, and re-throw the original error.
4. THE Tracing_Service SHALL expose a `getActiveTraceId()` function that returns the Trace_ID string of the currently active span, or `undefined` if no span is active.

---

### Requirement 11: Graceful Degradation

**User Story:** As a platform engineer, I want the application to remain fully functional when tracing is disabled or the exporter is unavailable, so that observability infrastructure outages do not affect end users.

#### Acceptance Criteria

1. WHEN `OTEL_ENABLED` is `false`, THE Tracing_Service SHALL export a no-op implementation of all utility functions that returns immediately without error.
2. WHEN the Jaeger exporter fails to connect, THE application SHALL continue to handle HTTP requests with normal latency unaffected by export retries.
3. THE Tracing_Middleware SHALL add no more than 5ms of overhead to the p99 request latency under normal operating conditions.
4. IF the span buffer is full due to an unavailable exporter, THEN THE Tracing_Service SHALL drop the oldest buffered spans and log a warning rather than blocking the request path.
