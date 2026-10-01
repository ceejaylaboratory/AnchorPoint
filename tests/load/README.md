# Automated k6 Load Testing Suite

This directory contains the k6 load test suite for performance verification of the AnchorPoint backend endpoints.

## Overview

The load test (`tests/load/k6_sep_test.js`) simulates high concurrency workloads across core Stellar Anchor protocols:
- **SEP-10**: Stellar Web Authentication (`/auth`)
- **SEP-12**: KYC API (`/sep12/customer`)
- **SEP-24**: Interactive Deposit and Withdrawal API (`/sep24/info`, `/sep24/fee`)

## Test Configuration & Thresholds

- **VU Ramping Stages**:
  1. `0 -> 50 VUs` over 30s (Warm-up)
  2. `50 -> 200 VUs` over 1m (Moderate Load)
  3. `200 -> 500 VUs` over 2m (High Load Ramp)
  4. `500 VUs` sustained for 2m (Peak Capacity Verification)
  5. `500 -> 0 VUs` over 30s (Cool-down)

- **Performance Thresholds**:
  - `http_req_duration`: 95th percentile (p95) response latency **< 200ms**
  - `http_req_failed`: Total HTTP error rate **< 1%** (`rate < 0.01`)

## Prerequisites

Install [k6](https://k6.io/docs/get-started/installation/):

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

## Running the Load Tests

### 1. Run via npm script
From the root workspace or `backend` folder:
```bash
npm run test:load
```

### 2. Run directly with k6 CLI
```bash
k6 run tests/load/k6_sep_test.js
```

### 3. Run against custom backend environment
```bash
BASE_URL=http://localhost:3002 k6 run tests/load/k6_sep_test.js
```
