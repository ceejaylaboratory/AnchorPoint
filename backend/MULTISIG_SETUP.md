# Multi-signature Transaction Coordination Service - Setup Guide

## Overview

This guide will help you set up and configure the Multi-signature Transaction Coordination Service.

## Prerequisites

- Node.js 18+ installed
- PostgreSQL or SQLite database
- Stellar SDK knowledge
- Basic understanding of multi-signature transactions

## Installation Steps

### 1. Install Dependencies

The required dependencies are already included in `package.json`:
- `@stellar/stellar-sdk`: For Stellar transaction handling
- `@prisma/client`: For database operations
- `express`: Web framework
- `zod`: Schema validation

### 2. Database Migration

Run the Prisma migration to create the necessary database tables:

```bash
cd backend

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name add_multisig_models

# Or for production
npx prisma migrate deploy
```

This will create the following tables:
- `MultisigTransaction`: Stores transaction envelopes and metadata
- `MultisigSignature`: Tracks individual signatures
- `MultisigNotification`: Manages notifications to signers

### 3. Environment Configuration

No additional environment variables are required. The service uses the existing configuration from `backend/src/config/env.ts`.

Optional: Add these environment variables for enhanced functionality:

```env
# Stellar Network (default: TESTNET)
STELLAR_NETWORK=TESTNET
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org

# Notification settings (future enhancement)
NOTIFICATION_EMAIL_ENABLED=false
NOTIFICATION_WEBHOOK_URL=https://your-webhook-url.com
```

### 4. Verify Installation

Start the backend server:

```bash
npm run dev
```

Check that the multisig endpoints are available:

```bash
# Health check
curl http://localhost:3002/health

# Check API documentation
open http://localhost:3002/api-docs
```

You should see the multisig endpoints under the "Multisig" tag in Swagger UI.

## Database Schema

### MultisigTransaction Table

```sql
CREATE TABLE "MultisigTransaction" (
  "id" TEXT PRIMARY KEY,
  "envelopeXdr" TEXT NOT NULL,
  "hash" TEXT UNIQUE NOT NULL,
  "creatorPublicKey" TEXT NOT NULL,
  "requiredSigners" JSON NOT NULL,
  "threshold" INTEGER NOT NULL,
  "currentSignatures" INTEGER DEFAULT 0,
  "status" TEXT NOT NULL,
  "memo" TEXT,
  "expiresAt" DATETIME,
  "submittedAt" DATETIME,
  "stellarTxId" TEXT UNIQUE,
  "metadata" JSON,
  "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME
);

CREATE INDEX "idx_multisig_hash" ON "MultisigTransaction"("hash");
CREATE INDEX "idx_multisig_creator" ON "MultisigTransaction"("creatorPublicKey");
CREATE INDEX "idx_multisig_status" ON "MultisigTransaction"("status");
CREATE INDEX "idx_multisig_expires" ON "MultisigTransaction"("expiresAt");
```

### MultisigSignature Table

```sql
CREATE TABLE "MultisigSignature" (
  "id" TEXT PRIMARY KEY,
  "multisigTransactionId" TEXT NOT NULL,
  "signerPublicKey" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "signedAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("multisigTransactionId") REFERENCES "MultisigTransaction"("id") ON DELETE CASCADE,
  UNIQUE("multisigTransactionId", "signerPublicKey")
);

CREATE INDEX "idx_signature_transaction" ON "MultisigSignature"("multisigTransactionId");
CREATE INDEX "idx_signature_signer" ON "MultisigSignature"("signerPublicKey");
```

### MultisigNotification Table

```sql
CREATE TABLE "MultisigNotification" (
  "id" TEXT PRIMARY KEY,
  "multisigTransactionId" TEXT NOT NULL,
  "recipientPublicKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "sentAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "readAt" DATETIME,
  FOREIGN KEY ("multisigTransactionId") REFERENCES "MultisigTransaction"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_notification_transaction" ON "MultisigNotification"("multisigTransactionId");
CREATE INDEX "idx_notification_recipient" ON "MultisigNotification"("recipientPublicKey");
CREATE INDEX "idx_notification_read" ON "MultisigNotification"("readAt");
```

## Testing

### Run Unit Tests

```bash
npm test src/services/multisig.service.test.ts
```

### Manual Testing

1. **Create a test transaction**:

```bash
curl -X POST http://localhost:3002/api/multisig/transactions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "envelopeXdr": "AAAAAA...",
    "requiredSigners": [
      "GXXXXXX1...",
      "GXXXXXX2...",
      "GXXXXXX3..."
    ],
    "threshold": 2,
    "memo": "Test transaction"
  }'
```

2. **Add a signature**:

```bash
curl -X POST http://localhost:3002/api/multisig/transactions/{txId}/sign \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signedEnvelopeXdr": "AAAAAA..."
  }'
```

3. **Check pending transactions**:

```bash
curl http://localhost:3002/api/multisig/pending \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

4. **Get notifications**:

```bash
curl http://localhost:3002/api/multisig/notifications?unreadOnly=true \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## API Endpoints

All endpoints require authentication via JWT token.

### Transaction Management

- `POST /api/multisig/transactions` - Create new multisig transaction
- `GET /api/multisig/transactions` - Get all transactions for user
- `GET /api/multisig/transactions/:id` - Get specific transaction
- `GET /api/multisig/pending` - Get pending transactions needing signature
- `POST /api/multisig/transactions/:id/sign` - Add signature
- `POST /api/multisig/transactions/:id/submit` - Manually submit transaction

### Notifications

- `GET /api/multisig/notifications` - Get notifications
- `POST /api/multisig/notifications/read` - Mark notifications as read

## Configuration Options

### Transaction Expiration

Set expiration when creating transactions:

```json
{
  "envelopeXdr": "...",
  "requiredSigners": [...],
  "threshold": 2,
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

### Metadata

Add custom metadata for tracking:

```json
{
  "envelopeXdr": "...",
  "requiredSigners": [...],
  "threshold": 2,
  "metadata": {
    "department": "finance",
    "purpose": "vendor_payment",
    "amount": "1000 USDC",
    "approver": "CFO"
  }
}
```

## Monitoring

### Database Queries

Monitor these queries for performance:

```sql
-- Pending transactions per user
SELECT COUNT(*) FROM "MultisigTransaction"
WHERE "requiredSigners" LIKE '%GPUBKEY%'
AND "status" IN ('PENDING', 'PARTIALLY_SIGNED');

-- Unread notifications per user
SELECT COUNT(*) FROM "MultisigNotification"
WHERE "recipientPublicKey" = 'GPUBKEY'
AND "readAt" IS NULL;

-- Expired transactions
SELECT COUNT(*) FROM "MultisigTransaction"
WHERE "expiresAt" < CURRENT_TIMESTAMP
AND "status" NOT IN ('SUBMITTED', 'EXPIRED');
```

### Cleanup Jobs

Set up periodic cleanup jobs:

```typescript
// Cleanup expired transactions (run daily)
async function cleanupExpiredTransactions() {
  await prisma.multisigTransaction.updateMany({
    where: {
      expiresAt: { lt: new Date() },
      status: { in: ['PENDING', 'PARTIALLY_SIGNED'] },
    },
    data: {
      status: 'EXPIRED',
    },
  });
}

// Archive old completed transactions (run weekly)
async function archiveOldTransactions() {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  // Move to archive table or delete
  await prisma.multisigTransaction.deleteMany({
    where: {
      status: 'SUBMITTED',
      submittedAt: { lt: ninetyDaysAgo },
    },
  });
}
```

## Troubleshooting

### Issue: Signatures not merging correctly

**Solution**: Ensure all signers are signing the same transaction hash. Verify with:

```typescript
const tx = StellarSdk.TransactionBuilder.fromXDR(envelopeXdr, Networks.TESTNET);
console.log('Transaction hash:', tx.hash().toString('hex'));
```

### Issue: Transaction submission fails

**Possible causes**:
1. Invalid sequence number
2. Insufficient signatures
3. Network issues
4. Transaction expired

**Solution**: Check transaction details and Stellar network status.

### Issue: Notifications not appearing

**Solution**: 
1. Verify public key is in required signers
2. Check notification endpoint
3. Ensure database connection is working

## Security Considerations

1. **Authentication**: All endpoints require valid JWT tokens
2. **Authorization**: Users can only sign transactions they're required to sign
3. **Validation**: All inputs are validated using Zod schemas
4. **Signature Verification**: Signatures are verified against transaction hash
5. **Expiration**: Transactions can expire to prevent stale operations

## Performance Optimization

### Database Indexes

The schema includes indexes on frequently queried fields:
- Transaction hash (unique lookups)
- Creator public key (user queries)
- Transaction status (filtering)
- Signer public key (signature lookups)
- Notification read status (unread queries)

### Caching Strategy

Consider implementing caching for:
- Pending transaction counts
- Unread notification counts
- Recent transaction history

Example with Redis:

```typescript
// Cache pending count
const cacheKey = `pending:${publicKey}`;
let count = await redis.get(cacheKey);

if (!count) {
  count = await prisma.multisigTransaction.count({
    where: { /* ... */ },
  });
  await redis.setex(cacheKey, 300, count); // Cache for 5 minutes
}
```

## Next Steps

1. Review the [API Documentation](./MULTISIG_COORDINATION.md)
2. Implement frontend integration
3. Set up monitoring and alerts
4. Configure backup and recovery
5. Plan for scaling (if needed)

## Support

For issues or questions:
- Check the [documentation](./MULTISIG_COORDINATION.md)
- Review API responses and logs
- Create an issue in the repository
- Contact the development team
