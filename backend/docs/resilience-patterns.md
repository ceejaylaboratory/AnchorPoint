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
