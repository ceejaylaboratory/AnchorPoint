# Issue #224 — Encrypted Storage for Provider Keys: Reconnaissance Findings

## Executive Summary

This document captures all findings from the mandatory codebase reconnaissance phase for Issue #224. Every finding is specific to the AnchorPoint backend codebase and will drive all implementation decisions.

---

## 1. Project Structure & Runtime Environment

### Backend Organization
- **Runtime**: Node.js (v18+) with TypeScript
- **Framework**: Express.js
- **Database**: SQLite (via Prisma ORM) with migrations in `backend/prisma/migrations/`
- **Testing**: Jest with ts-jest preset
- **Logging**: Winston with structured JSON format
- **Key Dependencies**:
  - `@stellar/stellar-sdk` v14.6.1 (Stellar operations)
  - `@prisma/client` v6.19.2 (ORM)
  - `jsonwebtoken` v9.0.3 (JWT auth)
  - `zod` v4.3.6 (schema validation)
  - `ioredis` v5.3.0 (Redis client)
  - **NO AWS SDK, NO Vault client, NO HSM client currently present**

### Database
- **Provider**: SQLite (file-based)
- **ORM**: Prisma
- **Schema Location**: `backend/prisma/schema.prisma`
- **Migrations**: `backend/prisma/migrations/` with numbered directories (e.g., `20260424111121_add_contract_events`)
- **Migration Tooling**: Prisma CLI (`npx prisma migrate`)

---

## 2. Current Plaintext Key Storage & Usage

### Category A: Runtime Memory Only (Environment Variables)

**Location 1: `backend/src/config/env.ts` (lines 37-38)**
```typescript
STELLAR_FEE_BUMP_SECRET: z.string().optional(),
```
- **Current State**: Optional environment variable for fee-bump transaction signing
- **Exposure**: Read from `process.env` at startup, held in memory in `config` object
- **Usage**: Passed to Stellar SDK for fee-bump operations
- **Severity**: Category A (runtime memory only, no persistence)

**Location 2: `backend/src/api/controllers/info.controller.ts` (line 88)**
```typescript
signing_key: process.env.SIGNING_KEY || 'SB2Q6JYYK7GKXQJYRJLJHZFAP2Y7VJMLMIEUJQGHQFJ2D2K5A4HQKMF',
```
- **Current State**: Environment variable or hardcoded default
- **Exposure**: Returned in API response (SEP-1 info endpoint)
- **Severity**: Category B + D (exposed in API response AND hardcoded default)

### Category B: Exposed in API Responses

**Location 3: `backend/src/api/controllers/batch.controller.ts` (lines 30-40, 100-110)**
- **Current State**: `sourceSecretKey` accepted as request body parameter
- **Exposure**: Passed through request body, logged in debug statements
- **Usage**: Used to sign batch payment transactions
- **Severity**: Category B (passed through API, could be logged)

**Location 4: `backend/src/services/batch-payment.service.ts` (line 88)**
```typescript
const sourceKeypair = Keypair.fromSecret(request.sourceSecretKey);
```
- **Current State**: Secret key converted to Keypair immediately
- **Exposure**: Keypair object held in memory during transaction signing
- **Usage**: Signing batch payment transactions
- **Severity**: Category A (memory only, but no encryption)

### Category D: Hardcoded in Source

**Location 5: `backend/src/api/controllers/info.controller.ts` (line 88)**
```typescript
signing_key: process.env.SIGNING_KEY || 'SB2Q6JYYK7GKXQJYRJLJHZFAP2Y7VJMLMIEUJQGHQFJ2D2K5A4HQKMF',
```
- **Current State**: Hardcoded Stellar secret key as fallback
- **Exposure**: Visible in source code, returned in API response
- **Severity**: Category D (hardcoded) + Category B (exposed in response)

### Category C: Database Storage

**Finding**: No provider private keys are currently stored in the database. The Prisma schema (`backend/prisma/schema.prisma`) contains no columns for key material. Keys are only passed at runtime via environment variables or API requests.

---

## 3. Anchor Operation Consumption Points

### Batch Payment Service
- **File**: `backend/src/services/batch-payment.service.ts`
- **Method**: `executeBatch()` (line 63)
- **Key Access**: Line 88 - `Keypair.fromSecret(request.sourceSecretKey)`
- **Usage**: Signing transactions with `builtTransaction.sign(sourceKeypair)` (line 269)
- **Current Pattern**: Secret key passed as parameter, converted to Keypair, used for signing

### Info Controller
- **File**: `backend/src/api/controllers/info.controller.ts`
- **Method**: `getInfo()` (line 45)
- **Key Access**: Line 88 - `process.env.SIGNING_KEY || hardcoded_default`
- **Usage**: Returned in SEP-1 info response
- **Current Pattern**: Environment variable or hardcoded fallback

### Batch Controller
- **File**: `backend/src/api/controllers/batch.controller.ts`
- **Methods**: `executeBatchPayments()`, `executeChunkedBatchPayments()`, `retryFailedPayments()`
- **Key Access**: Extracted from request body, passed to `batchService.executeBatch()`
- **Usage**: Forwarded to batch payment service for signing
- **Current Pattern**: API endpoint accepts secret key in request body

---

## 4. Existing Crypto & Secrets Utilities

### Found: Webhook HMAC Signing
- **File**: `backend/src/services/webhook.service.ts` (line 1)
- **Utility**: `createHmac()` from Node.js `crypto` module
- **Usage**: HMAC-SHA256 for webhook payload signing
- **Pattern**: Uses `createHmac('sha256', secret).update(payload).digest('hex')`

### Not Found
- No existing key encryption/decryption utilities
- No existing vault/KMS integration
- No existing key rotation mechanism
- No existing secrets manager wrapper

---

## 5. Error Handling Patterns

### Canonical Error Type
- **File**: `backend/src/services/batch-payment.types.ts` (lines 77-95)
- **Pattern**: Custom error class extending `Error`
```typescript
export class BatchPaymentError extends Error {
  public type: BatchErrorType;
  public details?: any;
  constructor(type: BatchErrorType, message: string, details?: any) { ... }
}
```
- **Error Enum**: `BatchErrorType` with values like `EXCEEDS_MAX_OPS`, `INVALID_ADDRESS`, `TRANSACTION_FAILED`
- **Usage**: Errors are typed, include details object, and propagate with structured information

### Error Propagation Pattern
- Errors are caught and re-thrown with context
- Error messages are logged via Winston logger
- HTTP responses include error type and details
- No generic catch-all error handling

---

## 6. Logging Configuration & Patterns

### Logger Setup
- **File**: `backend/src/utils/logger.ts`
- **Library**: Winston v3.19.0
- **Format**: Structured JSON with trace context
- **Log Levels**: error, warn, info, debug (configurable via `LOG_LEVEL` env var)
- **Transports**: Console (always), File (production fallback), Logstash (if `LOGSTASH_HOST` set)

### Logging Patterns
- **Info Level**: Used for operation summaries (e.g., "Batch payment request: X operations")
- **Debug Level**: Used for detailed operation steps (e.g., "Added payment operation X")
- **Error Level**: Used for failures with error messages
- **No Sensitive Data Guards**: Current logging does NOT explicitly guard against logging key material

### Key-Related Logging
- **File**: `backend/src/services/batch-payment.service.ts` (lines 65, 95, 113, 124, 273)
- **Current**: Logs batch IDs, operation counts, transaction hashes, but NOT key material
- **Risk**: If key material is passed as a parameter to a logged function, it could be exposed

---

## 7. Test Framework & Patterns

### Test Setup
- **Framework**: Jest with ts-jest preset
- **Configuration**: `backend/jest.config.js`
- **Coverage Threshold**: 44% branches, 58% functions, 67% lines, 68% statements (current)
- **Target for New Code**: 95% (per issue requirements)

### Test Patterns Found

**Batch Payment Service Tests** (`backend/src/services/batch-payment.service.test.ts`)
- Mock Stellar SDK calls
- Use test fixtures with mock secret keys: `'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'`
- Test error scenarios with `expect().rejects.toThrow()`
- Test success scenarios with `expect().resolves.toEqual()`
- Mock external services (Stellar Horizon server)

**Mocking Pattern**
```typescript
jest.mock('@stellar/stellar-sdk');
const mockServer = (stellarService as any).server;
mockServer.submitTransaction.mockResolvedValue({ hash: '123', ledger: 456 });
```

**Error Testing Pattern**
```typescript
expect(
  batchService.executeBatch({ payments, sourceSecretKey: mockSecretKey })
).rejects.toThrow(BatchPaymentError);
```

---

## 8. CI/CD Configuration

### CI Workflow
- **File**: `.github/workflows/backend.yml`
- **Triggers**: Push to any branch, PR to main
- **Paths**: Only runs on changes to `backend/**`
- **Steps**:
  1. Setup Node.js v20
  2. Install dependencies
  3. Run Migration Integrity Checker
  4. Run Linter (`npm run lint`)
  5. Run Tests (`npm test`)

### Environment in CI
- `DATABASE_URL`: Set to `file:./test.db` for tests
- `SHADOW_DATABASE_URL`: Set to `file:./shadow.db` for migration checker
- No secrets are injected into CI environment
- No environment variables for key material

### Secrets Scanning
- **Not Found**: No gitleaks, truffleHog, or detect-secrets configuration in CI
- **Implication**: Secrets scanning must be added or verified separately

---

## 9. Configuration & Environment Variables

### Current Configuration Mechanism
- **File**: `backend/src/config/env.ts`
- **Library**: Zod for schema validation
- **Loading**: `dotenv.config()` at module load time
- **Validation**: Zod schema with `.safeParse()` and process exit on failure

### Current Key-Related Variables
```typescript
STELLAR_FEE_BUMP_SECRET: z.string().optional(),
SIGNING_KEY: (not in schema, read directly from process.env)
```

### Configuration Pattern
- All config is loaded at startup
- Config is validated and typed
- Invalid config causes process exit
- No lazy loading or runtime config changes

### .env.example
- **File**: Not found in reconnaissance (likely at root or backend root)
- **Current**: Likely contains example values for all env vars
- **Action Required**: Must remove plaintext key examples

---

## 10. Infrastructure & Deployment

### Current Infrastructure
- **Database**: SQLite (file-based, no external service)
- **Secrets Management**: None (environment variables only)
- **HSM/Vault**: None currently provisioned
- **Cloud Provider**: Not determined from codebase (could be AWS, GCP, Azure, or on-premise)

### Deployment Environment
- **Not Specified**: Codebase does not indicate target deployment environment
- **Implication**: Must support multiple vault/HSM options or determine from deployment context

---

## 11. Existing Key Rotation & Lifecycle Management

### Current State
- **No Key Rotation**: No mechanism exists for rotating provider keys
- **No Key Versioning**: No versioning or key ID tracking
- **No Key Lifecycle**: No expiration, revocation, or archival mechanism
- **Gap**: This is a significant gap that must be addressed minimally

---

## 12. Middleware & Request Lifecycle

### Authentication Middleware
- **File**: `backend/src/api/middleware/auth.middleware.ts`
- **Pattern**: JWT token validation
- **Scope**: Protects batch payment endpoints

### Request Lifecycle
- **Startup**: Config loaded via `env.ts`, environment variables read
- **Per-Request**: Auth middleware validates JWT, request body parsed
- **Key Access**: Currently happens in controller/service layer
- **Shutdown**: No explicit cleanup or key destruction

### Initialization Points
- **Application Startup**: `backend/src/index.ts`
- **Config Loading**: `backend/src/config/env.ts` (at module load)
- **Service Initialization**: Services instantiated in controllers

---

## 13. Security & PII Considerations

### Current Threat Model
- **Implicit**: Keys should not be exposed in logs, responses, or storage
- **Explicit**: No documented threat model or security policy found
- **Gaps**: No SECURITY.md or architecture decision records (ADRs)

### Key Material Classification
- Provider private keys are cryptographic secrets (highest sensitivity)
- Must be treated stricter than PII
- Current exposure: environment variables, API requests, hardcoded defaults

### Residual Risks (Post-Implementation)
- In-memory key exposure during signing operations
- Vault/KMS service as single point of failure
- Network latency for key retrieval
- Vault/KMS credentials themselves must be secured

---

## 14. Dependency Analysis

### AWS SDK Status
- **Not Present**: No AWS SDK in `package.json`
- **Implication**: If AWS KMS is chosen, must add `@aws-sdk/client-kms` dependency

### Vault Client Status
- **Not Present**: No HashiCorp Vault client in `package.json`
- **Implication**: If Vault is chosen, must add `node-vault` dependency

### Crypto Library Status
- **Present**: Node.js built-in `crypto` module (used for HMAC)
- **Implication**: Can use for local encryption if needed, but HSM/Vault is preferred

---

## 15. Database Schema & Migrations

### Current Schema
- **File**: `backend/prisma/schema.prisma`
- **Provider**: SQLite
- **Models**: User, ApiKey, Transaction, KycCustomer
- **No Key Storage**: No columns for provider private keys

### Migration Tooling
- **Tool**: Prisma CLI
- **Convention**: Numbered directories with timestamp (e.g., `20260424111121_add_contract_events`)
- **Files**: `migration.sql` inside each directory
- **Execution**: `npx prisma migrate dev` (dev), `npx prisma migrate deploy` (prod)

### Migration Pattern
- Migrations are transactional
- Rollback supported via `npx prisma migrate resolve`
- Schema changes are tracked in `prisma/schema.prisma`

---

## Summary of Findings

| Category | Finding | Severity |
|----------|---------|----------|
| **Key Storage** | No database storage; keys in env vars and API requests | Category A/B/D |
| **Exposure Points** | 5 locations: env vars, API response, hardcoded default, batch controller, batch service | Critical |
| **Crypto Utilities** | HMAC signing exists; no encryption utilities | Gap |
| **Error Handling** | Structured error types with details; no key-specific guards | Acceptable |
| **Logging** | Winston structured JSON; no explicit key guards | Gap |
| **Testing** | Jest with mocking; good patterns; no vault mocking yet | Acceptable |
| **CI/CD** | Linting, testing, migration checks; no secrets scanning | Gap |
| **Infrastructure** | SQLite, no vault/KMS; must be added | Gap |
| **Key Rotation** | No mechanism exists | Gap |
| **Dependencies** | No AWS SDK or Vault client; must add | Gap |

---

## Next Steps

Based on these findings, the implementation will:

1. **Select Vault/HSM Backend**: Determine based on deployment environment (AWS KMS recommended if AWS infrastructure exists, otherwise HashiCorp Vault)
2. **Create Wrapper Module**: Implement key management service following existing error and service patterns
3. **Add Dependencies**: Install appropriate SDK (AWS SDK or Vault client)
4. **Migrate Configuration**: Replace env var key storage with vault/KMS references
5. **Update Consumption Points**: Modify batch service and info controller to use wrapper
6. **Add Tests**: Implement 95% coverage with vault mocking
7. **Document**: Update architecture and operations documentation
8. **Audit Logging**: Add guards to prevent key material in logs

