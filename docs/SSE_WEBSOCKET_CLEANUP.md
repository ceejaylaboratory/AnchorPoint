# SSE and WebSocket Connection Cleanup (#1581)

Long-lived streams must not leave timers, listeners, or room memberships behind after a client disconnects.

## Server-Sent Events

- `EventDispatcherService.subscribe()` registers a 15-second heartbeat timer per client and returns an idempotent unsubscribe function.
- The unsubscribe function clears the heartbeat timer, removes the client from the registry, detaches `close`/`error` response listeners, and decrements `sse_active_connections`.
- Failed heartbeat or broadcast writes now call the same cleanup path, so a dead connection no longer leaves an interval running.
- `GET /api/events/stream` and the SEP-24 transaction stream register cleanup on request `close`, request `aborted`, and response `close`.
- SEP-24 additionally unsubscribes the Redis pub/sub client, removes its `message` listener, and quits the duplicate connection.

## Socket.IO

- On `disconnect`, the socket leaves every room (including its own id), all socket listeners are removed, and `websocket_active_connections` is decremented.
- Room lookups that resolve after a disconnect are ignored, preventing rooms from being re-joined for a gone client.

## Metrics

| Metric | Type | Meaning |
|--------|------|---------|
| `sse_active_connections` | gauge | Currently open SSE streams |
| `websocket_active_connections` | gauge | Currently connected Socket.IO clients |
