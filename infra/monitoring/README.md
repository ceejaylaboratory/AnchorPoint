# API Downtime Alerting

This directory contains the monitoring configuration used to detect AnchorPoint API downtime and route critical incidents to PagerDuty.

## What is monitored

1. Prometheus scrape health for the backend metrics target.
2. A synthetic HTTP probe against `GET /health`.
3. A warning signal for probe flapping before a full outage occurs.

## Alert routing

Critical alerts are routed to PagerDuty through Alertmanager.
Warning alerts use the same PagerDuty routing key so they remain visible in the same incident stream, but they are grouped and can be inhibited by the corresponding critical alert.

## Files

- `prometheus-alerts.yml`: Prometheus alert rules for API downtime.
- `alertmanager.yml`: PagerDuty routing and grouping policy.
- `blackbox.yml`: Synthetic HTTP probe module for the `/health` endpoint.

## Manual QA

1. Start the stack with `docker compose up prometheus alertmanager blackbox-exporter backend`.
2. Confirm Prometheus can scrape `anchorpoint-backend` and `anchorpoint-backend-health`.
3. Temporarily stop the backend container.
4. Verify `AnchorPointApiTargetDown` fires within about 2 minutes.
5. Restart the backend.
6. Confirm the alert resolves and Alertmanager would send a resolved notification to PagerDuty.

## PagerDuty setup

Set `PAGERDUTY_ROUTING_KEY` in the environment of the Alertmanager container. The key is intentionally not committed to the repository.
