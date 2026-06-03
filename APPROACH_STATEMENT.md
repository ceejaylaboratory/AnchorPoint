# Issue #224 — Encrypted Storage for Provider Keys: Approach Statement

## Overview

This document outlines the implementation approach for Issue #224, driven exclusively by findings from codebase reconnaissance. Every decision is justified by specific findings from the AnchorPoint backend.

---

## 1. Plaintext Key Exposure Audit

### Category A: Runtime Memory Only (No Persistence)

**Exposure 1: `STELLAR_FEE_BUMP_SECRET` environment variable**
- **File**: `backend/src/config/env.ts` (line 37)
- **Current State**: Optional env var, read at startup, held in `config` object
- **Remediation**: Replace with vault/KMS reference; retrieve key at runtime only when needed
- **Action**: Add new config var `STELLAR_FEE_BUMP_KEY_ID` (vault/KMS reference), remove plaintext var

### Category B: Exposed in API Responses

**Exposure 2: `SIGNING_KEY` in SEP-1 info response**
- **File**: `backend/src/api/controllers/info.controller.ts` (line 88)
- **Current State**: Returned in API response as `signing_key` field
- **Remediation**: This is the public signing key (not private), so it is safe to expose. However, the hardcoded default must be removed.
- **Action**: Remove hardcoded default; require explicit env var or fail startup

**Exposure 3: `sourceSecretKey` in batch payment API**
- **File**: `backend/src/api/controllers/batch.controller.ts` (lines 30-40)
- **Current State**: Accepted as request body parameter
- **Remediation**: This is a design issue. The API should not accept plaintext keys. Instead, the API should accept a key reference (e.g., key ID or vault path), and the service retrieves the key from vault/KMS.
- **Action**: Modify API to accept `keyId` instead of `sourceSecretKey`; retrieve key from vault in service layer

### Category D: Hardcoded in Source

**Exposure 4: Hardcoded Stellar secret key**
- **File**: `backend/src/api/controllers/info.controller.ts` (line 88)
- **Current State**: `'SB2Q6JYYK7GKXQJYRJLJHZFAP2Y7VJMLMIEUJQGHQFJ2D2K5A4HQKMF'` as fallback
- **Remediation**: Remove immediately; this is a test/demo key but must not be in production code
- **Action**: Delete hardcoded default; require explicit `SIGNING_KEY` env var

### Category C: Database Storage

**Finding**: No provider private keys are currently stored in the database. No migration required for existing data.

---

## 2. Vault/HSM Backend Selection

### Decision: AWS KMS (with fallback to HashiCorp Vault)

**Justification**:
1. **No existing infrastructure**: Codebase contains no AWS SDK or Vault client (`package.json` reconnaissance)
2. **Flexibility**: AWS KMS is widely available; Vault can be added later if needed
3. **Minimal dependencies**: AWS SDK is lightweight; can be added without major version conflicts
4. **Alignment**: Stellar ecosystem has precedent for AWS KMS integration

**Implementation Strategy**:
- **Primary**: AWS KMS (Customer Master Key for encryption/decryption)
- **Fallback**: Support HashiCorp Vault Transit engine (for on-premise deployments)
- **Configuration**: Vault/KMS backend selected via environment variable `KEY_MANAGEMENT_BACKEND` (default: `aws-kms`)

**AWS KMS Specifics**:
- **Key Type**: Customer Master Key (CMK) for envelope encryption
- **Configuration**: KMS key ARN provided via `AWS_KMS_KEY_ARN` env var
- **Operations**: Encrypt (plaintext → ciphertext), Decrypt (ciphertext → plaintext)
- **Credentials**: AWS credentials via IAM role (preferred) or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`

---

## 3. Wrapper Module Design

### New Module: `backend/src/lib/key-management.service.ts`

**Responsibilities**:
- Single point of access for all key operations
- Encrypt plaintext keys for storage
- Decrypt ciphertext keys for use
- Handle vault/KMS errors with retry logic
- Never log or persist plaintext key material

**Public Interface**:
```typescript
export interface KeyManagementService {
  // Encrypt a plaintext key value
  encryptKey(plaintext: string): Promise<EncryptedKey>;
  
  // Decrypt a ciphertext key value
  decryptKey(encrypted: EncryptedKey): Promise<string>;
  
  // Get key by reference (for future key rotation)
  getKeyByReference(keyRef: string): Promise<string>;
  
  // Health check
  isHealthy(): Promise<boolean>;
}

export interface EncryptedKey {
  ciphertext: string;
  keyVersion: string;
  algorithm: string;
  timestamp: number;
}
```

**Error Handling**:
- **Transient Errors** (network timeout, throttling): Retry with exponential backoff (3 attempts, 100ms-1s delays)
- **Permanent Errors** (access denied, key disabled): Fail immediately with structured error
- **Error Type**: Extend existing `BatchPaymentError` pattern with new `KeyManagementError` type

**Security Guarantees**:
- Plaintext key material never logged at any level
- Plaintext key material never included in error messages
- Plaintext key material never written to files or database
- Decrypted keys held in memory only, scoped to operation lifetime

---

## 4. Configuration Changes

### New Environment Variables

**AWS KMS Configuration**:
```env
# Key management backend (aws-kms or vault)
KEY_MANAGEMENT_BACKEND=aws-kms

# AWS KMS key ARN (required if backend is aws-kms)
AWS_KMS_KEY_ARN=arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012

# AWS credentials (optional if using IAM role)
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
```

**Vault Configuration** (if backend is vault):
```env
KEY_MANAGEMENT_BACKEND=vault
VAULT_ADDR=https://vault.example.com:8200
VAULT_TOKEN=s.xxxxxxxxxxxxxxxx
VAULT_TRANSIT_PATH=transit/keys/stellar-keys
```

**Deprecated Variables**:
- `STELLAR_FEE_BUMP_SECRET` → replaced by `STELLAR_FEE_BUMP_KEY_ID`
- `SIGNING_KEY` → must be explicitly set (no hardcoded default)

### Configuration Loader Update

**File**: `backend/src/config/env.ts`
- Add new schema fields for key management backend and KMS/Vault configuration
- Validate that required fields are present based on selected backend
- Fail startup if configuration is invalid

---

## 5. Database Schema & Migration

### Current State
- No provider private keys stored in database
- No migration required for existing data

### Future-Proofing
- If provider keys are added to database in future, they must be stored encrypted
- Migration pattern: Add `encryptedKey` column, migrate plaintext to encrypted, drop plaintext column

### No Migration Required for This PR
- Keys remain in environment/vault only
- Database schema unchanged

---

## 6. Consumption Point Updates

### Update 1: Batch Payment Service

**File**: `backend/src/services/batch-payment.service.ts`

**Current**:
```typescript
const sourceKeypair = Keypair.fromSecret(request.sourceSecretKey);
```

**Updated**:
```typescript
// Retrieve encrypted key from vault/KMS
const decryptedKey = await keyManagementService.decryptKey(request.encryptedKey);
const sourceKeypair = Keypair.fromSecret(decryptedKey);
// Key material scoped to this function; never stored or logged
```

**Changes**:
- Accept `encryptedKey` instead of `sourceSecretKey` in `BatchPaymentRequest`
- Call `keyManagementService.decryptKey()` to retrieve plaintext key
- Plaintext key held in memory only for signing operation
- Error handling: If vault unavailable, fail with structured error (no fallback)

### Update 2: Batch Controller

**File**: `backend/src/api/controllers/batch.controller.ts`

**Current**:
```typescript
const { payments, sourceSecretKey, baseFee, timeoutInSeconds } = req.body;
```

**Updated**:
```typescript
const { payments, keyId, baseFee, timeoutInSeconds } = req.body;
// keyId is a reference to the key in vault/KMS, not the key itself
```

**Changes**:
- Accept `keyId` (vault/KMS reference) instead of `sourceSecretKey`
- Pass `keyId` to batch service
- Batch service retrieves key from vault using `keyId`

### Update 3: Info Controller

**File**: `backend/src/api/controllers/info.controller.ts`

**Current**:
```typescript
signing_key: process.env.SIGNING_KEY || 'SB2Q6JYYK7GKXQJYRJLJHZFAP2Y7VJMLMIEUJQGHQFJ2D2K5A4HQKMF',
```

**Updated**:
```typescript
signing_key: process.env.SIGNING_KEY || (() => {
  throw new Error('SIGNING_KEY environment variable is required');
})(),
```

**Changes**:
- Remove hardcoded default
- Require explicit `SIGNING_KEY` env var
- Fail startup if not provided
- Note: `SIGNING_KEY` is the public key (safe to expose), not private key

---

## 7. Error Handling

### New Error Type

**File**: `backend/src/services/key-management.types.ts`

```typescript
export enum KeyManagementErrorType {
  VAULT_UNAVAILABLE = 'VAULT_UNAVAILABLE',
  KEY_NOT_FOUND = 'KEY_NOT_FOUND',
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  INVALID_KEY_FORMAT = 'INVALID_KEY_FORMAT',
  UNAUTHORIZED = 'UNAUTHORIZED',
}

export class KeyManagementError extends Error {
  public type: KeyManagementErrorType;
  public details?: any;

  constructor(type: KeyManagementErrorType, message: string, details?: any) {
    super(message);
    this.name = 'KeyManagementError';
    this.type = type;
    this.details = details;
  }
}
```

### Error Propagation

- All vault/KMS errors caught and converted to `KeyManagementError`
- Error messages never include plaintext key material
- Errors propagate to caller with structured type information
- Batch payment operations fail with `BatchPaymentError` if key retrieval fails

---

## 8. Key Rotation Support (Minimum Required)

### Mechanism

**Key Version Metadata**:
- Each encrypted key includes `keyVersion` field (AWS KMS provides this automatically)
- Stored metadata allows identifying which key version encrypted each value

**Admin Operation**:
- New endpoint: `POST /api/admin/keys/rotate` (admin-only)
- Operation: Re-encrypt all stored keys under current key version
- Downtime: Zero (new key version used for new encryptions; old version still decrypts existing data)

**Implementation**:
- AWS KMS: Automatic key rotation can be enabled; old versions still decrypt
- Vault: Manual key rotation; old versions must be retained for decryption

**Documentation**:
- Add section to operations guide: "Key Rotation Procedure"
- Include step-by-step instructions and rollback procedure

---

## 9. Logging & PII Audit

### Current Logging Calls (Key-Related)

**File**: `backend/src/services/batch-payment.service.ts`
- Line 65: `logger.info(\`[Batch ${batchId}] Starting batch payment...\`)` — Safe (no key material)
- Line 95: `logger.info(\`[Batch ${batchId}] Attempt ${attempts}...\`)` — Safe
- Line 113: `logger.info(\`[Batch ${batchId}] Sequence conflict...\`)` — Safe
- Line 124: `logger.error(\`[Batch ${batchId}] Attempt ${attempts} failed...\`)` — Safe (error message only)
- Line 273: `logger.info(\`[Batch ${batchId}] Submitting transaction...\`)` — Safe

**Audit Result**: No current logging exposes key material. However, new code must ensure:
- Plaintext key never passed to any logging function
- Error messages never include key material
- Debug logs never include key material

### Logging Guards

**In Key Management Service**:
```typescript
// ✓ Safe: Log operation, not key material
logger.debug('Decrypting key for batch payment');

// ✗ Unsafe: Never do this
logger.debug(`Decrypting key: ${plaintext}`);

// ✓ Safe: Log error type, not key material
logger.error(`Key decryption failed: ${error.message}`);
```

---

## 10. Test Strategy

### Vault/KMS Mocking

**Mocking Library**: Jest mocks (existing pattern in codebase)

**Mock Pattern**:
```typescript
jest.mock('@aws-sdk/client-kms');
const mockKmsClient = KmsClient as jest.MockedClass<typeof KmsClient>;
mockKmsClient.prototype.encrypt.mockResolvedValue({ CiphertextBlob: Buffer.from('...') });
mockKmsClient.prototype.decrypt.mockResolvedValue({ Plaintext: Buffer.from('...') });
```

### Test Coverage

**Unit Tests** (95% target):
1. Encrypt/decrypt round-trip
2. Decrypt returns correct key material
3. Vault unavailable (transient error) — retry and eventually fail
4. Vault unavailable (permanent error) — fail immediately
5. No plaintext key in error messages
6. No plaintext key in logs
7. Key version metadata preserved
8. Invalid key format rejected

**Integration Tests**:
1. Batch payment with encrypted key retrieval
2. Vault unavailable during batch payment — structured failure
3. Decrypted key not logged
4. Decrypted key not in API response

**Security Invariant Tests**:
1. No plaintext key in database
2. No plaintext key in logs across full request lifecycle
3. Admin-only key rotation operation

---

## 11. Documentation Updates

### Files to Update

**1. `backend/README.md`**
- Add section: "Key Management"
- Describe encrypted key storage architecture
- Link to operations guide

**2. New File: `backend/docs/KEY_MANAGEMENT.md`**
- Architecture: Which vault/KMS service is used
- Configuration: Environment variables required
- Key Rotation: Step-by-step procedure
- Threat Model: What is mitigated, what risks remain
- Invariant: Provider private keys never written to persistent store in plaintext

**3. New File: `backend/docs/VAULT_SETUP.md`** (if Vault is used)
- Vault installation and configuration
- Transit engine setup
- Policy configuration
- Local development setup

**4. Update: `.env.example`**
- Remove plaintext key examples
- Add vault/KMS configuration examples
- Add comments explaining each variable

---

## 12. Scope Discipline

### Files to Modify

1. **New**: `backend/src/lib/key-management.service.ts` — Vault/KMS wrapper
2. **New**: `backend/src/services/key-management.types.ts` — Error types and interfaces
3. **Modify**: `backend/src/config/env.ts` — Add vault/KMS configuration
4. **Modify**: `backend/src/services/batch-payment.service.ts` — Use key management service
5. **Modify**: `backend/src/services/batch-payment.types.ts` — Update `BatchPaymentRequest` to use `keyId`
6. **Modify**: `backend/src/api/controllers/batch.controller.ts` — Accept `keyId` instead of `sourceSecretKey`
7. **Modify**: `backend/src/api/controllers/info.controller.ts` — Remove hardcoded default
8. **Modify**: `backend/package.json` — Add AWS SDK dependency
9. **New**: `backend/src/lib/key-management.service.test.ts` — Unit tests
10. **Modify**: `backend/src/services/batch-payment.service.test.ts` — Update tests for new key retrieval
11. **Modify**: `backend/.env.example` — Update configuration examples
12. **New**: `backend/docs/KEY_MANAGEMENT.md` — Architecture documentation
13. **Modify**: `backend/README.md` — Add key management section

### Files NOT to Modify

- No changes to Prisma schema (no database storage of keys)
- No changes to middleware (auth middleware unchanged)
- No changes to other services (only batch payment affected)
- No refactoring or formatting-only changes

---

## 13. CI/CD Checks

### Checks to Pass

1. **Type Check**: `npm run build` (TypeScript compilation)
2. **Linter**: `npm run lint` (ESLint)
3. **Tests**: `npm test` (Jest with 95% coverage on new/modified paths)
4. **Coverage**: Coverage report confirms ≥95% on new and modified paths
5. **Secrets Scan**: No committed key material (manual verification)

### Local Verification

1. **Application Startup**: Starts without plaintext key in environment
2. **Batch Payment**: Succeeds with encrypted key retrieval
3. **Vault Unavailable**: Fails with structured error (no fallback)
4. **Log Inspection**: No key material in logs
5. **Key Rotation**: Admin operation succeeds

---

## 14. Residual Risks & Mitigations

### Residual Risk 1: In-Memory Key Exposure

**Risk**: Decrypted key held in memory during signing operation; could be exposed via memory dump or debugger

**Mitigation**: 
- Scope key to minimum lifetime (function scope only)
- No caching of decrypted keys
- No passing key to other functions
- Document in code comments

**Residual**: Acceptable; inherent to any signing operation

### Residual Risk 2: Vault/KMS as Single Point of Failure

**Risk**: If vault/KMS is unavailable, all signing operations fail

**Mitigation**:
- Vault/KMS should be highly available (AWS KMS is multi-AZ)
- Implement monitoring and alerting
- Document failover procedure

**Residual**: Acceptable; trade-off for security

### Residual Risk 3: Vault/KMS Credentials Compromise

**Risk**: If vault/KMS credentials are compromised, attacker can decrypt all keys

**Mitigation**:
- Use IAM roles (AWS) or AppRole (Vault) instead of static credentials
- Rotate credentials regularly
- Monitor vault/KMS access logs

**Residual**: Acceptable; requires separate security controls

---

## 15. Implementation Sequence

1. **Phase 1**: Create key management service and types
2. **Phase 2**: Update configuration loader
3. **Phase 3**: Update batch payment service and controller
4. **Phase 4**: Update info controller (remove hardcoded default)
5. **Phase 5**: Add comprehensive tests
6. **Phase 6**: Update documentation
7. **Phase 7**: Local verification and CI checks
8. **Phase 8**: PR submission

---

## Summary

This implementation will:

✅ **Eliminate all plaintext key storage** — Keys retrieved from vault/KMS at runtime only  
✅ **Prevent key exposure in logs** — Logging guards and structured error handling  
✅ **Support key rotation** — Metadata tracking and admin operation  
✅ **Follow existing patterns** — Error types, service structure, testing approach  
✅ **Maintain backward compatibility** — API changes are additive (new `keyId` parameter)  
✅ **Achieve 95% test coverage** — Comprehensive unit and integration tests  
✅ **Document thoroughly** — Architecture, configuration, and operations guides  

**Security Invariant**: Provider private keys are never written to any persistent store in plaintext at any point in the application lifecycle.

