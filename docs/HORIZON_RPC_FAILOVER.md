# Horizon and Soroban RPC failover (#1587)

`StellarService` routes transaction lookups, account loads and submissions through
a small health-tracking failover layer. This protects the backend from temporary
Horizon/Soroban gateway failures (HTTP 502/503/504) and network timeouts.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `STELLAR_HORIZON_URL` | `https://horizon-testnet.stellar.org` | Primary Horizon endpoint. |
| `STELLAR_HORIZON_FALLBACK_URLS` | unset | Comma-separated standby Horizon endpoints. |
| `STELLAR_RPC_URLS` | network default | Comma-separated Soroban RPC endpoints; the first is primary. |
| `STELLAR_FAILOVER_FAILURE_THRESHOLD` | `2` | Consecutive failures before an endpoint is marked degraded. |
| `STELLAR_FAILOVER_PROBE_INTERVAL_MS` | `30000` | Background probe interval for degraded endpoints. |

Values are validated at startup in `backend/src/config/env.ts`. No dependency on
the admin-editable dynamic config is introduced, so failover endpoints require a
process restart to change.

## Behaviour

- The active endpoint is index `0` on startup and after `setNetwork()`.
- A retryable failure (429, any 5xx, or a timeout/network error) increments the
  endpoint's consecutive-failure counter.
- Once the threshold is reached, the endpoint is marked degraded and traffic is
  routed to the next healthy endpoint. A single endpoint still uses the legacy
  exponential-backoff retry behaviour, so deployments without standbys are
  unchanged.
- Non-retryable errors (for example HTTP 400) are surfaced immediately.
- If all endpoints are degraded the last error is thrown; no unhandled exception
  escapes to callers beyond the existing error contract.
- A submission that times out may have been accepted upstream. Horizon
  deduplicates by transaction hash, so retrying on a standby is safe; the
  failover log line records both URLs for reconciliation.
- `startFailoverMonitor()` (called from `backend/src/index.ts` startup) probes
  degraded endpoints every `STELLAR_FAILOVER_PROBE_INTERVAL_MS`. A successful
  probe resets health and restores primary routing. `stopFailoverMonitor()` is
  called during graceful shutdown, and probe timers are unref'd.

## Prometheus metrics

| Metric | Type | Labels |
| --- | --- | --- |
| `rpc_node_health` | gauge | `provider`, `node_index` |
| `rpc_node_failover_total` | counter | `provider`, `from_node`, `to_node`, `reason` |
| `rpc_node_recovery_total` | counter | `provider`, `node_index` |

`provider` is `horizon` or `soroban-rpc`. A failover increments
`rpc_node_failover_total` with a reason such as `http_504` or `network_etimedout`.
Metrics are exposed through the existing `/metrics` endpoint.

## Verification

```bash
npm run build -w backend
npm run lint -w backend
npm test -w backend -- --runTestsByPath src/services/stellar.service.test.ts
```

The failover suite mocks a primary 504 and a network timeout, verifies routing to
the standby, checks that 400 errors do not fail over, and exercises background
primary recovery.
