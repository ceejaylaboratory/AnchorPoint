# Encrypted Key Storage for Provider Keys

## Overview

This document describes the encrypted key storage architecture for AnchorPoint backend. Provider private keys used for anchor operations are now encrypted at rest using AWS KMS or HashiCorp Vault, ensuring they are never written to disk, logs, or any persistent store in plaintext.

## Architecture

### Security Invariant

**Provider private keys are never written to any persistent store in plaintext at any point in the application lifecycle.**

### Key Management Service

The `KeyManagementService` is the single point of access for all key operations:

- **Encryption**: Plaintext keys are encrypted using AWS KMS or Vault Transit engine
- **Decryption**: Ciphertext keys are decrypted on-demand, held in memory only
- **Error Handling**: Structured error types with retry logic for transient failures
- **Logging**: Plaintext key material is never logged at any level

### Supported Backends

#### AWS KMS (Recommended)

Uses AWS Key Management Service for envelope encryption:

- **Key Type**: Customer Master Key (CMK)
- **Encryption**: AES-256-GCM
- **Credentials**: IAM role (preferred) or static credentials
- **Availability**: Multi-AZ, highly available

#### HashiCorp Vault

Uses Vault Transit engine for encryption:

- **Engine**: Transit secrets engine
- **Encryption**: AES-256-GCM
- **Authentication**: Token-based
- **Availability**: Depends on deployment

## Configuration

### AWS KMS Configuration

Set the following environment variables:

```env
# Key management backend
KEY_MANAGEMENT_BACKEND=aws-kms

# AWS KMS key ARN (required)
AWS_KMS_KEY_ARN=arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012

# AWS region (optional, defaults to us-east-1)
AWS_REGION=us-east-1

# AWS credentials (optional if using IAM role)
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

### Vault Configuration

Set the following environment variables:

```env
# Key management backend
KEY_MANAGEMENT_BACKEND=vault

# Vault server address
VAULT_ADDR=https://vault.example.com:8200

# Vault authentication token
VAULT_TOKEN=s.xxxxxxxxxxxxxxxx

# Vault Transit engine path
VAULT_TRANSIT_PATH=transit/keys/stellar-keys
```

### Signing Key Configuration

The public signing key for SEP-1 info endpoint:

```env
# Public signing key (required)
SIGNING_KEY=GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

## Usage

### Batch Payment with Encrypted Key

#### Method 1: Using Encrypted Key Blob

```typescript
const result = await batchService.executeBatch({
  payments: [
    {
      destination: 'GXXXXXX...',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GXXXXXX...',
    },
  ],
  encryptedKey: {
    ciphertext: 'vault:v1:...',
    keyVersion: 'arn:aws:kms:...',
    algorithm: 'AES-256-GCM',
    timestamp: 1234567890,
  },
});
```

#### Method 2: Using Key ID (Vault/KMS Reference)

```typescript
const result = await batchService.executeBatch({
  payments: [
    {
      destination: 'GXXXXXX...',
      amount: '100',
      assetCode: 'USDC',
      assetIssuer: 'GXXXXXX...',
    },
  ],
  keyId: 'stellar-keys/production',
});
```

#### Method 3: Plaintext Key (Deprecated)

```typescript
const result = await batchService.executeBatch({
  payments: [...],
  sourceSecretKey: 'SAAAAAA...',
});
```

**Note**: Plaintext key method is deprecated and will be removed in a future version. Use encrypted key or key ID instead.

## Key Rotation

### Automatic Rotation (AWS KMS)

AWS KMS supports automatic key rotation:

1. Enable automatic key rotation in AWS KMS console
2. Old key versions automatically retained for decryption
3. New encryptions use the latest key version
4. No downtime required

### Manual Rotation (Vault)

For Vault, manual rotation is required:

1. Create new encryption key in Vault Transit engine
2. Update `VAULT_TRANSIT_PATH` to point to new key
3. Old ciphertexts remain decryptable with old key version
4. New encryptions use new key

### Rotation Procedure

```bash
# 1. Verify current key is working
curl -X GET http://localhost:3002/health

# 2. Update key configuration (if needed)
# For AWS KMS: Update AWS_KMS_KEY_ARN
# For Vault: Update VAULT_TRANSIT_PATH

# 3. Restart application
systemctl restart anchorpoint-backend

# 4. Verify health check passes
curl -X GET http://localhost:3002/health

# 5. Test batch payment with new key
curl -X POST http://localhost:3002/api/batch/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payments": [...],
    "keyId": "stellar-keys/production"
  }'
```

## Error Handling

### Transient Errors

Transient errors (network timeout, throttling) are automatically retried:

- **Max Retries**: 3 attempts
- **Backoff**: Exponential (100ms, 200ms, 400ms)
- **Errors**: ThrottlingException, RequestLimitExceededException, ECONNREFUSED, ETIMEDOUT

### Permanent Errors

Permanent errors fail immediately without retry:

- **AccessDeniedException**: Insufficient permissions
- **NotFoundException**: Key not found
- **InvalidCiphertextException**: Corrupted ciphertext

### Error Response

```json
{
  "success": false,
  "error": "Failed to retrieve signing key: Key not found in Vault",
  "type": "TRANSACTION_FAILED"
}
```

## Security Considerations

### Threat Model

**Mitigated Threats**:
- Plaintext key exposure in logs
- Plaintext key exposure in database dumps
- Plaintext key exposure in environment variables
- Plaintext key exposure in API responses
- Plaintext key exposure in error messages

**Residual Risks**:
- In-memory key exposure during signing operation (inherent to any signing)
- Vault/KMS service compromise (requires separate security controls)
- Vault/KMS credentials compromise (requires IAM/AppRole security)

### Best Practices

1. **Use IAM Roles**: For AWS KMS, use IAM roles instead of static credentials
2. **Use AppRole**: For Vault, use AppRole authentication instead of tokens
3. **Monitor Access**: Enable CloudTrail (AWS) or audit logging (Vault)
4. **Rotate Credentials**: Regularly rotate vault/KMS credentials
5. **Restrict Access**: Limit vault/KMS access to application service account only
6. **Network Security**: Use VPC endpoints or private networks for vault/KMS access

## Logging

### What is Logged

✅ **Safe to Log**:
- Operation type (encrypt, decrypt)
- Key version/ID (not the key itself)
- Error types and messages (without key material)
- Batch payment summaries (without key material)
- Transaction hashes and ledger information

### What is NOT Logged

❌ **Never Logged**:
- Plaintext key material
- Ciphertext (encrypted key blobs)
- Vault/KMS credentials
- API request bodies containing keys
- Error stack traces containing key material

### Log Examples

```json
{
  "level": "info",
  "message": "Key decrypted successfully via AWS KMS",
  "service": "anchorpoint-backend",
  "timestamp": "2024-04-27T10:30:00Z"
}
```

```json
{
  "level": "error",
  "message": "Failed to decrypt key via AWS KMS after 3 attempts",
  "error": "AccessDeniedException",
  "service": "anchorpoint-backend",
  "timestamp": "2024-04-27T10:30:05Z"
}
```

## Testing

### Unit Tests

Run key management service tests:

```bash
npm test -- src/lib/key-management.service.test.ts
```

### Integration Tests

Test with mocked vault/KMS:

```bash
npm test -- src/services/batch-payment.service.test.ts
```

### Local Development

For local development, use mocked vault/KMS:

```env
KEY_MANAGEMENT_BACKEND=aws-kms
AWS_KMS_KEY_ARN=arn:aws:kms:us-east-1:123456789012:key/test-key
```

The service will use mocked AWS SDK in test environment.

## Troubleshooting

### Issue: "Key not found in Vault"

**Cause**: Vault Transit engine path is incorrect or key doesn't exist

**Solution**:
1. Verify `VAULT_TRANSIT_PATH` is correct
2. Check Vault Transit engine exists: `vault list transit/keys/`
3. Verify application has permission to access the key

### Issue: "AccessDeniedException from AWS KMS"

**Cause**: IAM role or credentials don't have KMS permissions

**Solution**:
1. Verify IAM role has `kms:Decrypt` and `kms:Encrypt` permissions
2. Verify KMS key policy allows the IAM role
3. Check AWS credentials are correct

### Issue: "Batch payment fails with key retrieval error"

**Cause**: Vault/KMS is unavailable or key is invalid

**Solution**:
1. Check vault/KMS health: `curl http://vault:8200/v1/sys/health`
2. Verify key exists and is accessible
3. Check application logs for detailed error message
4. Verify network connectivity to vault/KMS

## Migration from Plaintext Keys

### Step 1: Backup Existing Keys

```bash
# Export all plaintext keys to secure location
export STELLAR_FEE_BUMP_SECRET=SAAAAAA...
export SIGNING_KEY=GBXXXXXX...
```

### Step 2: Set Up Vault/KMS

```bash
# For AWS KMS
aws kms create-key --description "AnchorPoint Stellar Keys"
aws kms create-alias --alias-name alias/anchorpoint-stellar-keys \
  --target-key-id <key-id>

# For Vault
vault secrets enable transit
vault write -f transit/keys/stellar-keys
```

### Step 3: Update Configuration

```env
KEY_MANAGEMENT_BACKEND=aws-kms
AWS_KMS_KEY_ARN=arn:aws:kms:us-east-1:123456789012:key/...
SIGNING_KEY=GBXXXXXX...
```

### Step 4: Deploy and Test

```bash
# Deploy updated application
npm run build
npm run start

# Test batch payment with new key management
curl -X POST http://localhost:3002/api/batch/payments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payments": [...],
    "keyId": "stellar-keys/production"
  }'
```

### Step 5: Remove Plaintext Keys

```bash
# Remove plaintext keys from environment
unset STELLAR_FEE_BUMP_SECRET

# Remove from .env files
# Remove from CI/CD secrets
# Remove from documentation examples
```

## References

- [AWS KMS Documentation](https://docs.aws.amazon.com/kms/)
- [HashiCorp Vault Documentation](https://www.vaultproject.io/docs)
- [Stellar SDK Documentation](https://developers.stellar.org/docs)
- [OWASP Key Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)

