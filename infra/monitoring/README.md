# API Downtime Alerting

This directory contains the monitoring configuration used to detect AnchorPoint API downtime and route critical incidents to PagerDuty.

## What is monitored

1. Prometheus scrape health for the backend metrics target.
2. A synthetic HTTP probe against `GET /health`.
3. A warning signal for probe flapping before a full outage occurs.
4. HTTP 5xx error rate spikes (`HighErrorRate`, root `alerts.yml`).
5. Database connection pool exhaustion (`DatabaseConnectionExhausted`, root `alerts.yml`).

## Alert routing

Critical alerts are routed to PagerDuty through Alertmanager.
Warning alerts use the same PagerDuty routing key so they remain visible in the same incident stream, but they are grouped and can be inhibited by the corresponding critical alert.
`DatabaseConnectionExhausted` is additionally routed to the `#ops-alerts` Slack channel via `SLACK_WEBHOOK_URL`.

## Files

- `prometheus-alerts.yml`: Prometheus alert rules for API downtime.
- `alertmanager.yml`: PagerDuty + Slack routing and grouping policy.
- `blackbox.yml`: Synthetic HTTP probe module for the `/health` endpoint.
- `../prometheus/alerts.rules.yml`: Performance alert rules (latency, error rate).
- `../../alerts.yml`: Error-spike and database-pool alert rules (#1008).

## Validating rule files

Rules are validated with `promtool` before deploy:

```bash
promtool check rules alerts.yml
promtool check rules infra/monitoring/prometheus-alerts.yml
promtool check config prometheus.yml
```

## DB connection metrics

The backend exposes `db_connections_active` and `db_connections_limit` gauges.
`DbMetricsScheduler` (`backend/src/workers/db-metrics.scheduler.ts`) samples `pg_stat_activity` every 15s so the `DatabaseConnectionExhausted` alert has a live signal.
SQLite dev/test datasources are skipped (only Postgres exposes connection stats).

## Manual QA

1. Start the stack with `docker compose up prometheus alertmanager blackbox-exporter backend`.
2. Confirm Prometheus can scrape `anchorpoint-backend` and `anchorpoint-backend-health`.
3. Temporarily stop the backend container.
4. Verify `AnchorPointApiTargetDown` fires within about 2 minutes.
5. Restart the backend.
6. Confirm the alert resolves and Alertmanager would send a resolved notification to PagerDuty.

## PagerDuty setup

Set `PAGERDUTY_ROUTING_KEY` in the environment of the Alertmanager container. The key is intentionally not committed to the repository.

## Slack setup

Set `SLACK_WEBHOOK_URL` in the environment of the Alertmanager container to enable the `#ops-alerts` channel receiver. The URL is intentionally not committed to the repository.
