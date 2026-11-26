# Circuit Breaker Resilience Patterns

## Why Circuit Breakers, Not Just Retries
Retries are useful for transient network blips, but they are dangerous during prolonged outages. If Horizon is down and taking 30 seconds to time out, and we retry 3 times, each request holds a Node.js thread and memory for 90 seconds. This rapidly exhausts the backend's resources, causing **cascading failures** where our own API goes down because a third-party is down. 

Circuit breakers solve this by **failing fast**. Once an error threshold is reached, the breaker opens and immediately rejects/falls back requests without ever attempting the network call, protecting our resources.

## State Diagram
```text
               +----------------------------------+
               |                                  |
               v                                  |
     +---------+---------+                 +------+------+
     |                   |    Threshold    |             |
     |      CLOSED       +---------------->+    OPEN     |
     |                   |     Reached     |             |
     +---------+---------+                 +------+------+
               ^                                  |
               |                                  | Reset Timeout
               |        +-----------------+       | Expires
               |        |                 |       |
               +--------+    HALF-OPEN    <-------+
              Probe     |                 |
             Success    +-----------------+
```

## Configured Thresholds
Breakers are configured via `createBreaker(name, fn, options)`. Default tuning:
- `timeout: 5000ms` - Maximum time before a request counts as a failure.
- `errorThresholdPercentage: 50` - % of requests that must fail to trip the breaker.
- `volumeThreshold: 10` - Minimum sample size before percentage is calculated.
- `resetTimeout: 30000ms` - Wait 30 seconds before sending a Half-Open probe.

## Fallback Behaviour Table
| Service | Operation | Fallback Action |
|---------|-----------|-----------------|
| Horizon | `fetchAccount` | Return cached account from Redis if exists; else throw `HorizonUnavailableError`. |
| Horizon | `submitTransaction` | Queue transaction for background retry. Return `{ status: 'queued' }`. |
| Horizon | `fetchBaseFee` | Return cached fee or hardcoded default (100 stroops). |
| Redis | `get` / `exists` | Return `null` / `0` (Cache Miss). Application degrades gracefully. |
| Redis | `set` / `del` | Swallow error, log warning, return success-like response. |
| 3rd Party | *Any* | Return `{ available: false, cached: true, data: LRUCacheData }`. |

## How to Add a New External Service
1. Create a new proxy file in `src/resilience/` (e.g. `notification.proxy.ts`).
2. Wrap the client calls with `createBreaker()`.
3. Chain `.fallback()` to define safe degradation behaviour.
4. Export the proxy in `src/resilience/index.ts`.
5. The breaker will automatically register for telemetry via the factory.

## Runbook: Stuck Open Breaker
If a breaker is stuck open in production and the external service is actually healthy:
1. Verify the `/metrics` endpoint to confirm if the `circuit_breaker_failures_total` is still incrementing (this means the Half-Open probes are failing).
2. Check if the external service has implemented rate limiting against our IP.
3. If necessary, a manual reset can be triggered (future admin endpoint) or simply restart the backend pod to reset the in-memory breaker state to CLOSED.

## Chaos Mesh Experiments

Staging-only Chaos Mesh manifests live in `infra/k8s/chaos/`:

- `network-chaos-horizon.yaml` — `NetworkChaos` with `action: netem` injects 500ms of latency (with 50ms jitter) and 5% packet loss on backend egress traffic to the configured Stellar Horizon endpoints.
- `pod-chaos-schedule.yaml` — a `Schedule` of type `PodChaos` creates a one-shot `pod-kill` experiment every 10 minutes. `mode: one` selects one backend replica at random, and the Deployment controller replaces it.

Before applying the manifests:

1. Install Chaos Mesh and verify both the controller and DaemonSet are healthy in the staging cluster.
2. Confirm the `NET_SCH_NETEM` kernel module is available on staging nodes.
3. Confirm the pod selector matches the deployed backend labels: `app.kubernetes.io/name: anchor-point` and `app.kubernetes.io/component: backend` in `anchorpoint-staging`.
4. Update `externalTargets` if `HORIZON_URL` uses a custom hostname, IP, or non-default port. The checked-in targets cover the public Stellar Horizon endpoints used by staging.

### Run Network and Pod Chaos

```bash
kubectl --context <staging-context> -n anchorpoint-staging apply \
  -f infra/k8s/chaos/network-chaos-horizon.yaml

kubectl --context <staging-context> -n anchorpoint-staging apply \
  -f infra/k8s/chaos/pod-chaos-schedule.yaml

kubectl --context <staging-context> -n anchorpoint-staging get networkchaos,schedule,podchaos -w
```

Start the load test after the experiments are `Running`/`Injected`:

```bash
BASE_URL=https://api.staging.anchorpoint.example.com \
  k6 run tests/load/k6_sep_test.js
```

The checked-in k6 suite uses a 1% HTTP error threshold for general capacity testing. The chaos acceptance gate is stricter: API 5xx errors must remain below 0.1% for the experiment window. Verify this in Prometheus rather than relying only on the k6 summary:

```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
```

The result must stay below `0.001` (0.1%) for the experiment window.

### Verify Circuit Breaker Behaviour

Watch backend logs on all replicas while the network fault is active:

```bash
kubectl --context <staging-context> -n anchorpoint-staging logs deploy/anchor-point \
  --all-containers --tail=200 -f | grep 'CIRCUIT_BREAKER'
```

Expected sequence for each affected Horizon breaker:

1. `opened` — enough Horizon calls timed out or failed for the breaker to fail fast.
2. `half-open` — the reset timeout expired and a probe request was allowed through.
3. `closed` — the probe succeeded after the chaos experiment was removed or expired.

Horizon breaker names include `horizon:fetchAccount`, `horizon:submitTransaction`, and `horizon:fetchBaseFee`. A clean recovery means probes return to `CLOSED` after the fault is removed and queued/fallback responses are reconciled without duplicate transactions.

### Cleanup and Data-Loss Checks

```bash
kubectl --context <staging-context> -n anchorpoint-staging delete \
  -f infra/k8s/chaos/pod-chaos-schedule.yaml \
  -f infra/k8s/chaos/network-chaos-horizon.yaml
```

After cleanup:

1. Confirm `kubectl get networkchaos,schedule,podchaos -n anchorpoint-staging` shows no remaining experiments.
2. Confirm all backend pods return to `Running`/`Ready` and the Deployment reports a completed rollout.
3. Re-run the Prometheus error-rate query and confirm it returns below `0.001`.
4. Check `transaction_reconciliation_total` and worker logs for unexpected duplicate or permanently failed transactions after pod kills.
5. Compare pre/post experiment database row counts or audit records for the affected staging flows; no rows should be lost or duplicated by the chaos run.
