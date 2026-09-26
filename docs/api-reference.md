# AnchorPoint API

Generated from `docs/openapi.json`. Do not edit by hand; run `node tools/generate-api-docs.js`.

AnchorPoint Backend API for Stellar SEP-24 Anchor Operations

Version: `1.0.0`

## Contents

- [Admin](#admin)
- [Auth](#auth)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Events](#events)
- [Fees](#fees)
- [Health](#health)
- [Info](#info)
- [Multisig](#multisig)
- [Notifications](#notifications)
- [Queue](#queue)
- [Relayer](#relayer)
- [Reports](#reports)
- [SEP-12](#sep-12)
- [SEP-24](#sep-24)
- [Transactions](#transactions)
- [Users](#users)

## Admin

### GET `/admin/network`

Get current Stellar network

**Responses**

- `200` — Current network type

### POST `/admin/network`

Switch Stellar network

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Network switched successfully
- `400` — Invalid network type

### PATCH `/api/admin/transactions/{id}`

Update transaction status

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Transaction status updated successfully

### POST `/admin/password-reset/request`

Request admin password reset

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Reset request accepted
- `400` — Invalid payload

### POST `/admin/password-reset/confirm`

Confirm admin password reset

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Password updated
- `400` — Invalid token or payload

### GET `/admin/transactions`

Get all transactions with pagination (Admin only)

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `page` | query | integer | no | Page number |
| `limit` | query | integer | no | Items per page |

**Responses**

- `200` — A paginated list of transactions
- `400` — Invalid query parameters
- `500` — Internal server error

## Auth

### POST `/auth`

SEP-10 Challenge Endpoint

Generates a SEP-10 challenge transaction for client authentication with multi-key support

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Challenge transaction generated
- `400` — Invalid request parameters

### POST `/auth/token`

SEP-10 Token Endpoint

Validates a signed challenge transaction and returns a JWT token with multi-key support

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Authentication successful
- `400` — Invalid or expired challenge
- `401` — Invalid signature

### POST `/auth/refresh`

SEP-10 Token Refresh Endpoint

Refreshes an existing valid JWT token

Authentication required.

**Responses**

- `200` — Token successfully refreshed
- `401` — Invalid or missing token

## Configuration

### GET `/config`

Get active configuration

Retrieves the current active dynamic configuration for the backend. Requires an API key with appropriate permissions (usually admin tier, but for now uses general API Key auth).

Authentication required.

**Responses**

- `200` — Active configuration retrieved
- `401` — Unauthorized

### POST `/config`

Update configuration

Updates the dynamic configuration, bumping the version and broadcasting the change to other instances.

Authentication required.

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Configuration updated successfully
- `400` — Validation error
- `401` — Unauthorized

### GET `/config/history`

Get configuration history

Retrieves past configuration versions (up to 20).

Authentication required.

**Responses**

- `200` — Configuration history retrieved
- `401` — Unauthorized

### POST `/config/rollback/{version}`

Rollback configuration

Reverts the configuration to a specific previous version.

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `version` | path | integer | yes | The version number to rollback to |

**Responses**

- `200` — Rolled back successfully
- `400` — Invalid version number
- `401` — Unauthorized
- `404` — Version not found

## Documentation

### GET `/api-docs`

API Documentation

Interactive Swagger UI documentation for the AnchorPoint API

**Responses**

- `200` — Swagger UI HTML page

## Events

### GET `/api/events`

Retrieve indexed Soroban contract events

Retrieve a history of indexed events from AnchorPoint contracts

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `contractId` | query | string | no | Filter by contract ID |
| `type` | query | string | no | Filter by event type (e.g., contract) |
| `limit` | query | integer | no | Number of records to return |
| `offset` | query | integer | no | Number of records to skip |

**Responses**

- `200` — List of events
- `500` — Server error

### GET `/api/events/health`

Get event indexer health status

Returns the current health of the event indexer, including last synced block and gap to ledger tip

**Responses**

- `200` — Health status
- `500` — Server error

## Fees

### GET `/fees/stats`

Network fee statistics

Returns current Stellar network fee stats including surge status and percentile fees.

**Responses**

- `200` — Fee statistics
- `502` — Failed to reach Horizon

### GET `/fees/estimate`

Estimate transaction fee

Returns an estimated fee for a transaction with the given number of operations.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `operations` | query | integer | no | Number of operations in the transaction |

**Responses**

- `200` — Fee estimate
- `502` — Failed to reach Horizon

### GET `/fees/calculate`

Calculate asset-specific fee

Returns the calculated fee for a given asset and amount using the asset's configured fee strategy.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `asset` | query | string | yes | Asset code (e.g. USDC, USD) |
| `amount` | query | number | yes | Transaction amount |

**Responses**

- `200` — Calculated fee
- `400` — Invalid parameters or unknown asset

## Health

### GET `/`

Root endpoint

Welcome message for the AnchorPoint API

**Responses**

- `200` — Welcome message

### GET `/health`

Health check

Check if the API server is running

**Responses**

- `200` — Server is healthy

## Info

### GET `/info`

SEP-1 Info Endpoint

Returns stellar.toml information in JSON or TOML format. Supports both JSON and TOML responses based on Accept header or format query parameter.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `format` | query | json \| toml | no | Response format preference (json or toml) |
| `Accept` | header | string | no | Accept header for content negotiation |

**Responses**

- `200` — Anchor information retrieved successfully

## Multisig

### GET `/api/multisig/transactions`

Get multisig transactions for the authenticated user

Retrieves all multisig transactions where the user is a required signer

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `status` | query | PENDING \| PARTIALLY_SIGNED \| READY \| SUBMITTED \| FAILED \| EXPIRED | no | Filter by transaction status |

**Responses**

- `200` — Transactions retrieved successfully
- `401` — Unauthorized

### POST `/api/multisig/transactions`

Create a new multisig transaction

Creates a new multisig transaction that requires signatures from multiple parties

Authentication required.

**Request body:** `object` (`application/json`)

**Responses**

- `201` — Transaction created successfully
- `400` — Invalid request
- `401` — Unauthorized

### POST `/api/multisig/transactions/{transactionId}/sign`

Add a signature to a multisig transaction

Adds the authenticated user's signature to a pending multisig transaction

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `transactionId` | path | string | yes | The multisig transaction ID |

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Signature added successfully
- `400` — Invalid request or signature
- `401` — Unauthorized
- `404` — Transaction not found

### GET `/api/multisig/transactions/{transactionId}`

Get a multisig transaction by ID

Retrieves details of a specific multisig transaction

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `transactionId` | path | string | yes | The multisig transaction ID |

**Responses**

- `200` — Transaction retrieved successfully
- `401` — Unauthorized
- `404` — Transaction not found

### GET `/api/multisig/pending`

Get pending transactions requiring signature

Retrieves all pending multisig transactions that need the user's signature

Authentication required.

**Responses**

- `200` — Pending transactions retrieved successfully
- `401` — Unauthorized

### POST `/api/multisig/transactions/{transactionId}/submit`

Manually submit a transaction

Manually submits a transaction that has reached the signature threshold

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `transactionId` | path | string | yes | The multisig transaction ID |

**Responses**

- `200` — Transaction submitted successfully
- `400` — Invalid request or transaction not ready
- `401` — Unauthorized
- `404` — Transaction not found

### GET `/api/multisig/notifications`

Get notifications for the authenticated user

Retrieves all notifications related to multisig transactions

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `unreadOnly` | query | true \| false | no | Filter to show only unread notifications |

**Responses**

- `200` — Notifications retrieved successfully
- `401` — Unauthorized

### POST `/api/multisig/notifications/read`

Mark notifications as read

Marks specified notifications as read

Authentication required.

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Notifications marked as read
- `401` — Unauthorized

## Notifications

### GET `/api/notifications/preferences`

Get notification preferences

Authentication required.

### PATCH `/api/notifications/preferences`

Update notification preferences

Authentication required.

### GET `/api/notifications/history`

Get notification history

Authentication required.

## Queue

### POST `/api/queue/jobs`

Add a new job to the queue

Creates a new job for contract interaction

Authentication required.

**Request body:** `object` (`application/json`)

**Responses**

- `201` — Job created successfully
- `400` — Invalid request
- `401` — Unauthorized

### POST `/api/queue/jobs/settlement`

Add a high-priority settlement job

Creates an urgent settlement job

Authentication required.

**Request body:** `object` (`application/json`)

**Responses**

- `201` — Settlement job created
- `400` — Invalid request
- `401` — Unauthorized

### POST `/api/queue/jobs/contract-call`

Add a contract call job

Creates a job to call a smart contract function

Authentication required.

**Request body:** `object` (`application/json`)

**Responses**

- `201` — Contract call job created
- `400` — Invalid request
- `401` — Unauthorized

### GET `/api/queue/jobs/{jobId}`

Get job status

Retrieves the current status of a job

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `jobId` | path | string | yes | Job ID |

**Responses**

- `200` — Job status retrieved
- `401` — Unauthorized
- `404` — Job not found

### GET `/api/queue/jobs/status/{status}`

Get jobs by status

Retrieves jobs with a specific status

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `status` | path | PENDING \| ACTIVE \| COMPLETED \| FAILED \| DELAYED \| RETRYING | yes |  |
| `limit` | query | integer | no |  |

**Responses**

- `200` — Jobs retrieved
- `401` — Unauthorized

### GET `/api/queue/my-jobs`

Get user's jobs

Retrieves all jobs created by the authenticated user

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `limit` | query | integer | no |  |

**Responses**

- `200` — Jobs retrieved
- `401` — Unauthorized

### POST `/api/queue/jobs/{jobId}/retry`

Retry a failed job

Queues a failed job for retry

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `jobId` | path | string | yes |  |

**Responses**

- `200` — Job queued for retry
- `400` — Invalid request
- `401` — Unauthorized

### POST `/api/queue/jobs/{jobId}/cancel`

Cancel a job

Cancels a pending or active job

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `jobId` | path | string | yes |  |

**Responses**

- `200` — Job cancelled
- `400` — Invalid request
- `401` — Unauthorized

### GET `/api/queue/metrics`

Get queue metrics

Retrieves queue statistics and metrics

Authentication required.

**Responses**

- `200` — Metrics retrieved
- `401` — Unauthorized

### POST `/api/queue/clean`

Clean old jobs

Removes old completed and failed jobs

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `days` | query | integer | no | Remove jobs older than this many days |

**Responses**

- `200` — Jobs cleaned
- `401` — Unauthorized

## Relayer

### POST `/api/relayer/approve`

Submit a token approval request with signature

The relayer verifies the signature and submits the transaction on behalf of the user

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Approval submitted successfully
- `400` — Invalid request or signature verification failed
- `500` — Internal server error

### POST `/api/relayer/verify`

Verify a signature without submitting

Pre-verification of signature before submission

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Signature verification result
- `400` — Invalid request
- `500` — Internal server error

### POST `/api/relayer/submit`

Submit a pre-signed transaction

Submit a transaction that's already signed by the user

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Transaction submitted successfully
- `400` — Invalid request or transaction failed
- `500` — Internal server error

### GET `/api/relayer/nonce`

Generate a nonce for approval requests

Returns a unique nonce to prevent replay attacks

**Responses**

- `200` — Nonce generated successfully
- `500` — Internal server error

### GET `/api/relayer/config`

Get relayer configuration

Returns public relayer configuration (excludes sensitive data)

**Responses**

- `200` — Relayer configuration
- `500` — Internal server error

## Reports

### GET `/api/reports/daily`

Generate daily fee report

Generates a daily fee report for anchor operations

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `date` | query | string | no | Date for the report (YYYY-MM-DD). Defaults to today. |

**Responses**

- `200` — Daily fee report generated successfully
- `500` — Internal server error

### GET `/api/reports/monthly`

Generate monthly fee report

Generates a monthly fee report for anchor operations

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `year` | query | integer | no | Year for the report. Defaults to current year. |
| `month` | query | integer | no | Month for the report (1-12). Defaults to current month. |

**Responses**

- `200` — Monthly fee report generated successfully
- `500` — Internal server error

### GET `/api/reports/daily/export`

Export daily fee report

Exports a daily fee report as JSON or PDF file

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `date` | query | string | no | Date for the report (YYYY-MM-DD). Defaults to today. |
| `format` | query | JSON \| PDF | no | Export format |

**Responses**

- `200` — Report file downloaded
- `400` — Invalid format parameter
- `500` — Internal server error

### GET `/api/reports/monthly/export`

Export monthly fee report

Exports a monthly fee report as JSON or PDF file

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `year` | query | integer | no | Year for the report. Defaults to current year. |
| `month` | query | integer | no | Month for the report (1-12). Defaults to current month. |
| `format` | query | JSON \| PDF | no | Export format |

**Responses**

- `200` — Report file downloaded
- `400` — Invalid format parameter
- `500` — Internal server error

### GET `/api/reports/history`

Get report history

Retrieves historical fee reports

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `type` | query | DAILY \| MONTHLY | no | Filter by report type |
| `limit` | query | integer | no | Maximum number of reports to return |

**Responses**

- `200` — Report history retrieved successfully
- `500` — Internal server error

## SEP-12

### GET `/sep12/customer`

Get customer KYC status

### PUT `/sep12/customer`

Upload customer information and documents

### DELETE `/sep12/customer/{account}`

Delete customer PII

### POST `/sep12/customer/upload-url`

Request a pre-signed URL for direct file upload

### POST `/sep12/customer/upload-confirm`

Confirm a direct file upload was completed

### POST `/sep12/webhook`

Webhook for 3rd party KYC provider updates

## SEP-24

### POST `/sep24/transactions/deposit/interactive`

Interactive Deposit

SEP-24 Interactive Deposit Endpoint. Returns a URL for the user to complete KYC/Deposit.

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Interactive deposit URL generated
- `400` — Invalid request parameters

### POST `/sep24/transactions/withdraw/interactive`

Interactive Withdrawal

SEP-24 Interactive Withdraw Endpoint. Returns a URL for the user to complete KYC/Withdraw.

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Interactive withdrawal URL generated
- `400` — Invalid request parameters

## Transactions

### GET `/api/transactions`

Get transaction history

Fetches transaction history for the authenticated user with pagination support.

Authentication required.

**Parameters**

| Name | In | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `page` | query | integer | no | Page number for pagination |
| `limit` | query | integer | no | Number of items per page |
| `assetCode` | query | string | no | Filter transactions by asset code (e.g., USDC, BTC) |
| `sender` | query | string | no | Search for transactions with matching sender metadata in indexed events |
| `receiver` | query | string | no | Search for transactions with matching receiver metadata in indexed events |
| `memo` | query | string | no | Search for transactions by memo or indexed event text |

**Responses**

- `200` — Transaction history retrieved successfully
- `401` — Unauthorized - Invalid or missing authentication token
- `500` — Internal server error

### POST `/api/transactions/submit`

Submit a pre-signed transaction

Validates and submits a pre-signed Stellar transaction XDR to the network.

Authentication required.

**Request body:** `object` (`application/json`)

**Responses**

- `200` — Transaction submitted successfully
- `400` — Invalid transaction or disallowed operation
- `429` — Rate limit exceeded

## Users

### GET `/api/users/hierarchy`

Get User Referral Hierarchy

Fetches the downline referral hierarchy for the authenticated user using a recursive CTE.

Authentication required.

**Responses**

- `200` — Hierarchy retrieved successfully
