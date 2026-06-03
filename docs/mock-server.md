# AnchorPoint Mock Server

## Why this exists
Integration tests in the AnchorPoint repository historically hit live Horizon and Soroban RPC testnet endpoints. This caused tests to be slow, network-dependent, and highly flaky due to public testnet resets and rate limits. 

This Mock Server provides a deterministic, local, lightning-fast replacement for `stellar-sdk` and frontend testing. It completely simulates the responses of Horizon and Soroban RPC using static fixtures and configurable failure scenarios.

## Quickstart
```bash
cd tools/mock-server
npm install
npm run dev
```
The server will start listening on:
- Horizon REST: `http://localhost:8000`
- Soroban RPC: `http://localhost:8001/soroban/rpc`

## How to switch scenarios from a test
The server exposes an admin endpoint to change the global mocked behavior (e.g., simulating a network drop). You can invoke this directly in your integration tests:

```typescript
// Switch to a transaction failure scenario
await fetch('http://localhost:8000/mock/scenario', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ scenario: 'TRANSACTION_FAILED' })
});
```

Available Scenarios: `HAPPY_PATH`, `NETWORK_TIMEOUT`, `TRANSACTION_FAILED`, `INSUFFICIENT_FEE`, `ACCOUNT_NOT_FOUND`, `LEDGER_ENTRY_MISSING`.

## How to add a new fixture
Ledger state is loaded from JSON files located in `tools/mock-server/fixtures/`. 
1. Create a new JSON file (e.g., `fixtures/anchorpoint-dev.json`) structured as a mapping of XDR Ledger Keys to XDR Ledger Entries:
```json
{
  "AAAAAgAAA...": "AAAAAwAAA..."
}
```
2. Modify `resetLedgerState()` in `src/ledger-state/index.ts` or expose an admin route to load your new fixture at runtime.

## CI Integration Example
In GitHub Actions, spin up the server in the background before running your tests:

```yaml
- name: Start Mock Server
  run: |
    cd tools/mock-server
    npm install
    npm run start &
  env:
    HORIZON_PORT: 8000
    SOROBAN_PORT: 8001

- name: Run Integration Tests
  run: npm run test:integration
  env:
    HORIZON_URL: http://localhost:8000
    SOROBAN_RPC_URL: http://localhost:8001/soroban/rpc
```
