# Database Pool Health Checks and Recovery (#1588)

Prisma connections can be dropped silently by NAT gateways, load balancers, or database failovers. AnchorPoint now detects these drops and recycles the pool automatically.

## Connection URL settings

For PostgreSQL datasources, `buildDatabaseUrl()` appends:

| Parameter | Source | Default |
|-----------|--------|---------|
| `connection_limit` | `DATABASE_POOL_SIZE` | `10` |
| `pool_timeout` | `DATABASE_POOL_TIMEOUT_MS` | `5s` |
| `sslmode` | `DB_SSL_MODE` | `disable` |
| `connect_timeout` | `DB_CONNECT_TIMEOUT_SECONDS` | `10` |
| `keepalives` | fixed | `1` |
| `keepalives_idle` | `DB_KEEPALIVE_IDLE_SECONDS` | `15` |
| `keepalives_interval` | `DB_KEEPALIVE_INTERVAL_SECONDS` | `5` |
| `keepalives_count` | `DB_KEEPALIVE_COUNT` | `3` |

SQLite URLs are left unchanged.

## Health monitor

`DatabaseHealthService` runs a `SELECT 1` probe every `DB_HEALTHCHECK_INTERVAL_MS` (default `15000`). After `DB_RECONNECT_FAILURE_THRESHOLD` consecutive failures (default `2`), it calls `$disconnect()` and reconnects with exponential backoff.

- Starts with the other schedulers and stops during graceful shutdown.
- `/health/ready` includes `dependencies.databasePool` and the latest `databasePool` health state.
- Overlapping probes are skipped.

## Metrics

| Metric | Type | Meaning |
|--------|------|---------|
| `db_connection_health` | gauge | `1` if the last probe succeeded, `0` otherwise |
| `db_reconnect_total` | counter | Pool recycle attempts |
| `db_healthcheck_failures_total` | counter | Failed probes |
