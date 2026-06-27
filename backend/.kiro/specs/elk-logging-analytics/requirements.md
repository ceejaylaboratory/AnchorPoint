# Requirements Document

## Introduction

This feature transitions the AnchorPoint backend from file-based Winston logging to a structured ELK (Elasticsearch, Logstash, Kibana) stack. All log entries are emitted as structured JSON, shipped to Elasticsearch via Logstash (or a Logstash-compatible pipeline), and visualized through Kibana dashboards. The feature also introduces an alerting system for critical production anomalies such as elevated error rates and API latency spikes. The existing OpenTelemetry tracing pipeline (trace IDs, span IDs) is preserved and correlated within every log entry.

## Glossary

- **ELK_Stack**: The combination of Elasticsearch, Logstash, and Kibana used for log aggregation, storage, and visualization.
- **Elasticsearch**: The distributed search and analytics engine that stores and indexes structured log documents.
- **Logstash**: The data processing pipeline that ingests, transforms, and forwards log events to Elasticsearch.
- **Kibana**: The web-based visualization layer for querying and dashboarding data stored in Elasticsearch.
- **Logger**: The existing Winston logger instance defined in `backend/src/utils/logger.ts`.
- **Log_Entry**: A single structured JSON object emitted by the Logger representing one log event.
- **Log_Shipper**: The Winston transport responsible for forwarding Log_Entry objects to the Logstash endpoint.
- **Structured_Log_Format**: The canonical JSON schema that every Log_Entry must conform to, including mandatory and optional fields.
- **Error_Rate**: The ratio of HTTP responses with status 5xx to total HTTP responses within a rolling time window.
- **API_Latency**: The elapsed time in milliseconds between receiving an HTTP request and sending the HTTP response.
- **Alert**: A notification dispatched when a monitored metric crosses a configured threshold.
- **Alert_Manager**: The component (Kibana Alerting or Elasticsearch Watcher) responsible for evaluating alert rules and dispatching notifications.
- **Kibana_Dashboard**: A Kibana saved dashboard object containing panels for error rates, API latency, and log volume.
- **Trace_ID**: The 128-bit OpenTelemetry trace identifier already injected by the existing tracing pipeline.
- **Span_ID**: The 64-bit OpenTelemetry span identifier already injected by the existing tracing pipeline.
- **Index_Pattern**: The Elasticsearch index naming convention used to organize log documents by date (e.g., `anchorpoint-logs-YYYY.MM.DD`).
- **Dead_Letter_Queue**: A fallback buffer that stores Log_Entry objects that could not be delivered to Logstash.

---

## Requirements

### Requirement 1: Structured JSON Log Format

**User Story:** As a platform engineer, I want every log entry to be emitted as a structured JSON object with a consistent schema, so that Logstash and Elasticsearch can reliably parse and index all fields.

#### Acceptance Criteria

1. THE Logger SHALL emit every Log_Entry as a JSON object containing at minimum the fields: `timestamp` (ISO 8601), `level`, `message`, `service`, `environment`, `traceId`, and `spanId`.
2. WHEN a log entry is produced outside of an active OpenTelemetry span, THE Logger SHALL omit `traceId` and `spanId` rather than emitting null or empty string values.
3. WHEN a log entry includes an Error object, THE Logger SHALL serialize the `error.message` and `error.stack` fields as top-level JSON fields named `errorMessage` and `errorStack`.
4. THE Logger SHALL include a `requestId` field in every Log_Entry produced within an active HTTP request context, using the value from the `x-request-id` header if present, or a generated UUID otherwise.
5. THE Logger SHALL include a `httpMethod`, `httpRoute`, and `httpStatusCode` field in Log_Entry objects produced by HTTP request lifecycle events.
6. THE Structured_Log_Format SHALL be enforced in all environments, including development and test, so that format regressions are caught before production deployment.

---

### Requirement 2: Log Shipper Transport

**User Story:** As a platform engineer, I want Winston to forward log entries directly to Logstash over TCP/UDP, so that logs are centralized in the ELK stack without relying on file polling.

#### Acceptance Criteria

1. THE Log_Shipper SHALL forward every Log_Entry to a Logstash endpoint configured via the `LOGSTASH_HOST` and `LOGSTASH_PORT` environment variables.
2. WHEN `LOGSTASH_HOST` is not set, THE Logger SHALL skip adding the Log_Shipper transport and continue logging to the console transport only.
3. WHEN the Logstash endpoint is unreachable, THE Log_Shipper SHALL buffer up to a configurable number of Log_Entry objects (default: 1000) in a Dead_Letter_Queue before dropping the oldest entries.
4. WHEN the Logstash connection is restored after a failure, THE Log_Shipper SHALL automatically reconnect and flush the Dead_Letter_Queue in FIFO order.
5. THE Log_Shipper SHALL not block the application request path; all delivery attempts SHALL be asynchronous.
6. IF the Dead_Letter_Queue reaches its capacity limit, THEN THE Logger SHALL emit a warning to the console transport indicating the number of dropped entries.

---

### Requirement 3: Elasticsearch Index Management

**User Story:** As a platform engineer, I want log documents stored in date-partitioned Elasticsearch indices, so that I can manage retention and query performance efficiently.

#### Acceptance Criteria

1. THE Logstash pipeline SHALL write Log_Entry documents to Elasticsearch using the Index_Pattern `anchorpoint-logs-YYYY.MM.DD`, where the date is derived from the Log_Entry `timestamp` field.
2. THE Logstash pipeline SHALL map the `level` field to an Elasticsearch keyword type to enable exact-match filtering in Kibana.
3. THE Logstash pipeline SHALL map the `traceId` and `spanId` fields to Elasticsearch keyword types to enable trace correlation queries.
4. THE Logstash pipeline SHALL map the `timestamp` field to an Elasticsearch date type using ISO 8601 format.
5. WHEN a Log_Entry document fails Elasticsearch indexing, THE Logstash pipeline SHALL route the document to a dead-letter index named `anchorpoint-logs-dlq` rather than silently dropping it.

---

### Requirement 4: File Transport Removal

**User Story:** As a platform engineer, I want the file-based log transports removed from production, so that the system relies solely on the ELK stack for log persistence and avoids disk space issues.

#### Acceptance Criteria

1. WHEN `NODE_ENV` is `production` and `LOGSTASH_HOST` is set, THE Logger SHALL not add file transports for `error.log` or `combined.log`.
2. WHEN `NODE_ENV` is `production` and `LOGSTASH_HOST` is not set, THE Logger SHALL retain the existing file transports as a fallback and emit a startup warning indicating that ELK shipping is disabled.
3. WHEN `NODE_ENV` is not `production`, THE Logger SHALL not add file transports regardless of `LOGSTASH_HOST` configuration.

---

### Requirement 5: Kibana Dashboard

**User Story:** As a platform engineer, I want a pre-built Kibana dashboard that visualizes error rates and API latency, so that I can monitor production health at a glance.

#### Acceptance Criteria

1. THE Kibana_Dashboard SHALL include a panel displaying the Error_Rate as a time-series chart with a configurable rolling window (default: 5 minutes).
2. THE Kibana_Dashboard SHALL include a panel displaying API_Latency percentiles (p50, p95, p99) as a time-series chart, sourced from the `durationMs` field in Log_Entry objects.
3. THE Kibana_Dashboard SHALL include a panel displaying log volume by `level` (error, warn, info, debug) as a stacked bar chart over time.
4. THE Kibana_Dashboard SHALL include a panel displaying a filterable log table showing the most recent 100 Log_Entry objects with columns for `timestamp`, `level`, `message`, `traceId`, and `httpRoute`.
5. THE Kibana_Dashboard SHALL be exportable as a Kibana saved-objects JSON file so that it can be version-controlled and imported into any Kibana instance.
6. WHERE `traceId` is present in a log table row, THE Kibana_Dashboard SHALL render the `traceId` as a hyperlink to the corresponding Jaeger trace using the `JAEGER_UI_URL` environment variable.

---

### Requirement 6: Alerting for Critical Production Anomalies

**User Story:** As a platform engineer, I want automated alerts triggered when error rates or API latency exceed defined thresholds, so that I am notified of production anomalies before they impact users.

#### Acceptance Criteria

1. THE Alert_Manager SHALL evaluate the Error_Rate every 1 minute using a rolling 5-minute window.
2. WHEN the Error_Rate exceeds 5% within the rolling window, THE Alert_Manager SHALL dispatch an Alert with severity `critical`.
3. THE Alert_Manager SHALL evaluate the p99 API_Latency every 1 minute using a rolling 5-minute window.
4. WHEN the p99 API_Latency exceeds 2000ms within the rolling window, THE Alert_Manager SHALL dispatch an Alert with severity `warning`.
5. WHEN the p99 API_Latency exceeds 5000ms within the rolling window, THE Alert_Manager SHALL dispatch an Alert with severity `critical`.
6. THE Alert_Manager SHALL dispatch Alerts to at least one notification channel configured via environment variables; supported channels SHALL include webhook URL (`ALERT_WEBHOOK_URL`) and email (`ALERT_EMAIL_RECIPIENTS`).
7. WHEN an Alert condition is resolved (metric returns below threshold), THE Alert_Manager SHALL dispatch a recovery notification to the same channels.
8. IF neither `ALERT_WEBHOOK_URL` nor `ALERT_EMAIL_RECIPIENTS` is configured, THEN THE Alert_Manager SHALL log a startup warning indicating that no alert notification channels are configured.

---

### Requirement 7: Request Duration Logging

**User Story:** As a platform engineer, I want every HTTP request to produce a log entry containing the request duration, so that API latency data is available in Elasticsearch for dashboard queries and alerting.

#### Acceptance Criteria

1. WHEN an HTTP response is sent, THE Logger SHALL emit a Log_Entry at `info` level containing the fields `httpMethod`, `httpRoute`, `httpStatusCode`, and `durationMs` (integer milliseconds).
2. THE `durationMs` field SHALL be calculated as the elapsed time from when the request was received by the Express application to when the response headers are written.
3. WHEN `httpStatusCode` is 5xx, THE Logger SHALL emit the request completion Log_Entry at `error` level instead of `info`.
4. WHEN `httpStatusCode` is 4xx, THE Logger SHALL emit the request completion Log_Entry at `warn` level instead of `info`.

---

### Requirement 8: Log Sampling for High-Volume Routes

**User Story:** As a platform engineer, I want to configure log sampling rates per route, so that high-frequency health-check and metrics endpoints do not flood Elasticsearch with low-value entries.

#### Acceptance Criteria

1. THE Logger SHALL support a `LOG_SAMPLE_ROUTES` environment variable containing a JSON object mapping route patterns to sampling ratios between `0.0` and `1.0` (e.g., `{"GET /health": 0.01, "GET /metrics": 0.0}`).
2. WHEN a request matches a sampled route pattern, THE Logger SHALL emit the request completion Log_Entry only if a random value falls within the configured sampling ratio.
3. WHEN `LOG_SAMPLE_ROUTES` is not set or is invalid JSON, THE Logger SHALL log all routes without sampling and emit a startup warning if the value is invalid.
4. WHEN a sampled Log_Entry is dropped, THE Logger SHALL not increment any error counters or produce any secondary log entries for the dropped event.

---

### Requirement 9: Graceful Degradation

**User Story:** As a platform engineer, I want the application to remain fully functional when the ELK stack is unavailable, so that logging infrastructure outages do not affect end users.

#### Acceptance Criteria

1. WHEN the Logstash endpoint is unreachable at startup, THE application SHALL start successfully and continue handling HTTP requests.
2. WHEN the Log_Shipper fails to deliver a Log_Entry, THE application SHALL not throw an unhandled exception or alter the HTTP response to the client.
3. THE Log_Shipper SHALL add no more than 2ms of overhead to the p99 request latency under normal operating conditions.
4. WHEN `LOGSTASH_HOST` is not configured, THE Logger SHALL operate in console-only mode with no reduction in functionality.
