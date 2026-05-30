# QA: Manual Testing of Withdrawal Flow on Testnet

**Issue:** [#430](https://github.com/ceejaylaboratory/AnchorPoint/issues/430)  
**Category:** QA — Testnet Deployment Readiness

---

## Overview

This document provides manual QA steps for validating the SEP-24 withdrawal (off-ramp) flow against the AnchorPoint testnet deployment. It covers the full interactive withdrawal lifecycle from asset selection through KYC to transaction completion.

The automated regression suite lives at:
`backend/src/test/withdrawal-flow-testnet.test.ts`

---

## Prerequisites

| Requirement | Details |
|---|---|
| Testnet backend running | `http://localhost:3002` (or configured `VITE_API_BASE_URL`) |
| Testnet USDC issuer | `GBBD47IF6LWLVNC7F7YSACOA73YI4COI3V5O2S46F7S44GUL44YQY4O2` |
| Funded testnet wallet | Use [Stellar Friendbot](https://friendbot.stellar.org) |
| Dashboard running | `http://localhost:5173` (Vite dev server) |
| `INTERACTIVE_URL` env var | Set to the testnet interactive endpoint |

---

## Manual QA Steps

### 1. Navigate to the Withdrawal Tab

- [ ] Open the dashboard at `http://localhost:5173`
- [ ] Click **Withdraw** in the left sidebar
- [ ] Confirm the page heading reads "Withdraw" and the subtitle mentions SEP-24
- [ ] Confirm the step indicator shows Step 1 of 3: "Select Asset"

### 2. Asset Selection

- [ ] Verify the asset list renders (USDC, EURT, ARST shown as buttons)
- [ ] Click **USDC** — confirm the flow advances to Step 2 (Identity Verification)
- [ ] Navigate back to Step 1 and confirm the step indicator resets correctly

### 3. KYC / Identity Verification (Step 2)

- [ ] Confirm the KYC placeholder panel is visible with the "Launch KYC Portal" button
- [ ] Confirm the KYC requirements panel on the right lists the configured fields (firstName, lastName, country)
- [ ] Click **Launch KYC Portal** — confirm the flow advances to Step 3

### 4. Transaction Completion (Step 3)

- [ ] Confirm the success screen shows "Transaction Initiated"
- [ ] Confirm the message references the brand name from the backend config
- [ ] Click **Back to Dashboard** — confirm the flow resets to Step 1

### 5. Backend API — Interactive Withdrawal Endpoint

Use `curl` or the Postman collection (`docs/postman-collection.json`) to test the API directly.

#### 5a. Missing asset_code

```bash
curl -s -X POST http://localhost:3002/sep24/transactions/withdraw/interactive \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Expected:** `400` with `{ "error": "asset_code is required" }`

#### 5b. Unsupported asset

```bash
curl -s -X POST http://localhost:3002/sep24/transactions/withdraw/interactive \
  -H "Content-Type: application/json" \
  -d '{"asset_code": "DOGE"}' | jq .
```

**Expected:** `400` with error containing `"DOGE is not supported"`

#### 5c. Valid USDC withdrawal

```bash
curl -s -X POST http://localhost:3002/sep24/transactions/withdraw/interactive \
  -H "Content-Type: application/json" \
  -d '{
    "asset_code": "USDC",
    "account": "GTESTACCOUNT123",
    "amount": "100.00",
    "lang": "en"
  }' | jq .
```

**Expected:** `200` with:
```json
{
  "type": "interactive_customer_info_needed",
  "url": "https://<INTERACTIVE_URL>/kyc-withdraw?transaction_id=<uuid>&asset_code=USDC&account=GTESTACCOUNT123&amount=100.00&lang=en",
  "id": "<uuid>"
}
```

Verify:
- [ ] `type` is `interactive_customer_info_needed`
- [ ] `id` is a valid UUID
- [ ] `url` pathname is `/kyc-withdraw`
- [ ] `url` contains `transaction_id` matching `id`
- [ ] `url` contains `asset_code=USDC` (uppercase)
- [ ] `url` contains `account` and `amount` params

#### 5d. Lowercase asset_code normalisation

```bash
curl -s -X POST http://localhost:3002/sep24/transactions/withdraw/interactive \
  -H "Content-Type: application/json" \
  -d '{"asset_code": "usdc"}' | jq .url
```

**Expected:** URL contains `asset_code=USDC` (uppercased)

#### 5e. Expired quote rejection

```bash
# First create an expired quote in the DB, then:
curl -s -X POST http://localhost:3002/sep24/transactions/withdraw/interactive \
  -H "Content-Type: application/json" \
  -d '{"asset_code": "USDC", "quote_id": "<expired-quote-id>"}' | jq .
```

**Expected:** `400` with `{ "error": "Quote has expired" }`

#### 5f. Valid quote acceptance

```bash
curl -s -X POST http://localhost:3002/sep24/transactions/withdraw/interactive \
  -H "Content-Type: application/json" \
  -d '{"asset_code": "USDC", "quote_id": "<valid-quote-id>"}' | jq .
```

**Expected:** `200` with `interactive_customer_info_needed`

### 6. Accessibility Checks

- [ ] Tab through the withdrawal flow using keyboard only — all interactive elements reachable
- [ ] Step indicator announces current step to screen readers (aria-live region present)
- [ ] Asset selection buttons have descriptive `aria-label` attributes
- [ ] "Launch KYC Portal" button is keyboard-focusable with visible focus ring
- [ ] Step completion screen has `role="img"` with descriptive `aria-label` on the success icon

### 7. Responsive / Mobile

- [ ] Open the dashboard at 375px viewport width
- [ ] Confirm the sidebar collapses and the hamburger menu appears
- [ ] Complete the full withdrawal flow on mobile viewport without layout breakage

---

## Automated Test Coverage

The file `backend/src/test/withdrawal-flow-testnet.test.ts` covers:

| Scenario | Test |
|---|---|
| Missing `asset_code` | ✅ |
| Unsupported asset | ✅ |
| Empty `asset_code` string | ✅ |
| Successful 200 response | ✅ |
| Transaction ID in response and URL | ✅ |
| Testnet `INTERACTIVE_URL` used in redirect | ✅ |
| `/kyc-withdraw` pathname | ✅ |
| `asset_code` normalised to uppercase | ✅ |
| Default `lang=en` | ✅ |
| Custom `lang` forwarded | ✅ |
| Optional params omitted when absent | ✅ |
| `account` and `amount` forwarded | ✅ |
| All optional params together | ✅ |
| `quote_id` not found → 400 | ✅ |
| Expired quote → 400 | ✅ |
| Valid quote → 200 | ✅ |
| No `quote_id` → prisma not called | ✅ |
| USDC supported on testnet | ✅ |
| USD supported on testnet | ✅ |
| BTC not in testnet asset config → 400 | ✅ |

Run the suite:

```bash
cd backend
npx jest --testPathPatterns="withdrawal-flow-testnet" --no-coverage
```

---

## Pass / Fail Criteria

The withdrawal flow passes QA when:

1. All automated tests in `withdrawal-flow-testnet.test.ts` pass
2. All manual steps above are checked off
3. No console errors appear in the browser during the flow
4. The backend returns correct HTTP status codes for all validation scenarios
5. The interactive URL contains all required query parameters
