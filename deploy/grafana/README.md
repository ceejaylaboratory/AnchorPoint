# Grafana Dashboards — AnchorPoint

Pre-configured Grafana dashboards for monitoring AnchorPoint in any environment.
Dashboards are provisioned automatically at startup — no manual UI setup needed.

## Directory layout

```
deploy/grafana/
├── dashboards/
│   ├── api-overview.json          # HTTP request rate, latency p50/p95/p99, error rate
│   ├── database-performance.json  # Prisma connection pool, query durations, slow queries
│   ├── redis-cache.json           # Hit/miss rate, memory, evictions, connected clients
│   └── stellar-rpc-overview.json  # Horizon/Soroban RPC latency, HTTP status mix, rate limits
└── provisioning/
    ├── dashboards/
    │   └── anchorpoint.yml        # Grafana dashboard-provider config
    └── datasources/
        └── prometheus.yml         # Prometheus data-source config
```

## Quick start (Docker Compose)

Add the following service to your `docker-compose.yml` (or `docker-compose.prod.yml`):

```yaml
services:
  grafana:
    image: grafana/grafana:10.4.3
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: "${GRAFANA_ADMIN_PASSWORD:-admin}"
      GF_PATHS_PROVISIONING: /etc/grafana/provisioning
    volumes:
      - ./deploy/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./deploy/grafana/dashboards:/etc/grafana/dashboards:ro
      - grafana-data:/var/lib/grafana
    depends_on:
      - prometheus
    restart: unless-stopped

volumes:
  grafana-data:
```

Then start the stack:

```bash
docker compose up -d grafana
```

Open Grafana at <http://localhost:3000> (default credentials: `admin` / `admin` — **change immediately in production**).

## Dashboards

### AnchorPoint — API Overview (`api-overview.json`)

| Panel | Metric |
|---|---|
| HTTP Requests / sec by Route | `http_requests_total` |
| HTTP 5xx Error Rate | ratio of 5xx to total requests |
| API Latency (p50 / p95 / p99) | `http_request_duration_ms_bucket` |

### AnchorPoint — Database Performance (`database-performance.json`)

| Panel | Metric |
|---|---|
| Active DB Connections / Queries | `prisma_client_queries_active` |
| Connection Pool Utilisation | `prisma_pool_connections_busy / open` |
| Query Duration Percentiles | `prisma_datasource_queries_duration_histogram_ms_bucket` |
| Slow Queries (> 500 ms / > 1 s) | same histogram, filtered buckets |

> **Note**: Requires the [Prisma OpenTelemetry integration](https://www.prisma.io/docs/concepts/components/prisma-client/opentelemetry-tracing) or a custom Prometheus middleware that exposes `prisma_*` metrics.

### AnchorPoint — Redis Cache (`redis-cache.json`)

| Panel | Metric |
|---|---|
| Cache Hit Rate | `redis_keyspace_hits_total / (hits + misses)` |
| Hits & Misses / sec | rates of hit/miss counters |
| Redis Memory Usage | `redis_memory_used_bytes`, `redis_memory_max_bytes` |
| Evictions & Expirations | `redis_evicted_keys_total`, `redis_expired_keys_total` |
| Connected & Blocked Clients | `redis_connected_clients`, `redis_blocked_clients` |

> **Note**: Requires [redis_exporter](https://github.com/oliver006/redis_exporter) scraped by Prometheus.

### AnchorPoint — Stellar RPC Overview (`stellar-rpc-overview.json`)

| Panel | Metric | Threshold |
|---|---|---|
| RPC Request Rate (QPS by endpoint) | `stellar_rpc_requests_total` | — |
| RPC Latency (p50 / p90 / p99) | `stellar_rpc_request_duration_ms_bucket` | — |
| Horizon Error Rate (HTTP 429 / 5xx) | ratio of 429 + 5xx to total Horizon requests | red above **2 %** |
| Remaining Horizon Rate Limit | `stellar_horizon_rate_limit_remaining` | red below **10 %** |
| Soroban RPC Simulation Latency | `stellar_soroban_simulate_duration_ms_bucket` | — |

> **Note**: Requires a Prometheus scrape target exposing the `stellar_*` metrics
> (Horizon proxy / Soroban RPC client instrumentation). Panels refresh every 30 s
> from the provisioned Prometheus datasource.

## Verifying a dashboard locally

1. Start Grafana (and Prometheus) with Docker Compose:

   ```bash
   docker compose up -d prometheus grafana
   ```

2. Confirm the dashboard was provisioned — open
   <http://localhost:3000/dashboards> and look for **AnchorPoint — Stellar RPC Overview**
   (or query the API: `curl -u admin:admin http://localhost:3000/api/search?query=Stellar`).

3. Open the dashboard and check that each panel renders data from the
   **Prometheus** datasource (select it in the panel's datasource picker if it is
   not already the default). Empty panels usually mean the `stellar_*` metrics are
   not being scraped yet.

4. Verify alert highlighting by temporarily lowering the error-rate threshold or
   pointing the panels at a test series that exceeds 2 % errors / drops below 10 %
   remaining rate limit — the affected panels should turn red.

## Prometheus scrape configuration

Ensure your `prometheus.yml` includes:

```yaml
scrape_configs:
  - job_name: anchorpoint-backend
    static_configs:
      - targets: ["backend:3002"]
    metrics_path: /metrics

  - job_name: redis
    static_configs:
      - targets: ["redis-exporter:9121"]
```

## Alerting

The dashboard thresholds align with the alert rules in
`infra/monitoring/prometheus-alerts.yml`. Import or reference that file in
Alertmanager for pager / Slack notifications when metrics breach the thresholds
shown in red on the gauges.
