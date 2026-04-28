# Batch Payment Component - Quick Start Guide

## Overview

The Batch Payment Component allows you to combine multiple Stellar payments into a single transaction, reducing network overhead and simplifying sequence number management for concurrent workers.

## Key Features

✅ **Batch up to 100 payments** in a single Stellar transaction  
✅ **Redis-based sequence locking** prevents conflicts across concurrent workers  
✅ **Automatic retry logic** handles partial batch failures  
✅ **Chunked processing** for large payment lists (>100)  
✅ **Comprehensive validation** before transaction submission  

## Installation

### 1. Install Dependencies

```bash
cd backend
npm install uuid @types/uuid
```

### 2. Configure Environment

Add to your `.env` file:

```env
# Stellar Network Configuration
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Redis Configuration (for sequence number management)
REDIS_URL=redis://localhost:6379
```

### 3. Start Redis

The sequence number manager requires Redis:

```bash
# Using Docker
docker run -d -p 6379:6379 redis:alpine

# Or install locally
# macOS: brew install redis && redis-server
# Ubuntu: sudo apt install redis-server && sudo systemctl start redis
```

## Quick Start Example

### Basic Usage

```typescript
import { BatchPaymentService } from './services/batch-payment.index';

// Initialize service
const batchService = new BatchPaymentService();

// Define payments
const payments = [
  {
    destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    amount: '10.5',
  },
  {
    destination: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    amount: '20.0',
  },
];

// Execute batch
const result = await batchService.executeBatch({
  payments,
  sourceSecretKey: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
});

console.log(`Transaction: ${result.transactionHash}`);
console.log(`Fee: ${result.feePaid} stroops`);
```

### Using the API

```bash
# Start the backend server
cd backend
npm run dev

# Send batch payment request
curl -X POST http://localhost:3000/api/batch/payments \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payments": [
      {
        "destination": "GBBBB...",
        "amount": "10.5"
      },
      {
        "destination": "GCCCC...",
        "amount": "20.0"
      }
    ],
    "sourceSecretKey": "SAAAA..."
  }'
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/batch/payments` | Execute batch (up to 100 payments) |
| POST | `/api/batch/payments/chunked` | Execute large batches (>100 payments) |
| POST | `/api/batch/payments/retry` | Retry failed payments |

## File Structure

```
backend/src/
├── services/
│   ├── batch-payment.types.ts          # Type definitions
│   ├── batch-payment.service.ts        # Core service logic
│   ├── sequence-number.service.ts      # Sequence number management
│   ├── batch-payment.index.ts          # Module exports
│   ├── batch-payment.examples.ts       # Usage examples
│   ├── batch-payment.service.test.ts   # Unit tests
│   └── BATCH_PAYMENT_README.md         # Full documentation
└── api/
    ├── controllers/
    │   └── batch.controller.ts         # API controller
    └── routes/
        └── batch.route.ts              # API routes
```

## Testing

Run the test suite:

```bash
cd backend
npm test -- batch-payment.service.test.ts
```

## Common Use Cases

### 1. Payroll Processing

```typescript
const payrollPayments = employees.map(emp => ({
  destination: emp.stellarAddress,
  amount: emp.salary.toString(),
}));

await batchService.executeBatch({
  payments: payrollPayments,
  sourceSecretKey: COMPANY_SECRET_KEY,
});
```

### 2. Airdrop Distribution

```typescript
const airdropPayments = recipients.map(r => ({
  destination: r.address,
  amount: r.amount.toString(),
  assetCode: 'TOKEN',
  assetIssuer: TOKEN_ISSUER,
}));

// For >100 recipients, use chunked processing
await batchService.executeBatchInChunks(airdropPayments, SECRET_KEY, 100);
```

### 3. Vendor Payments

```typescript
const vendorPayments = invoices.map(inv => ({
  destination: inv.vendorAddress,
  amount: inv.amount.toString(),
}));

const result = await batchService.executeBatch({
  payments: vendorPayments,
  sourceSecretKey: SECRET_KEY,
});

// Track transaction
console.log(`Batch TX: ${result.transactionHash}`);
```

## Error Handling

```typescript
import { BatchPaymentError, BatchErrorType } from './services/batch-payment.types';

try {
  await batchService.executeBatch({ payments, sourceSecretKey });
} catch (error) {
  if (error instanceof BatchPaymentError) {
    switch (error.type) {
      case BatchErrorType.EXCEEDS_MAX_OPS:
        console.error('Too many payments. Use chunked processing.');
        break;
      case BatchErrorType.INVALID_ADDRESS:
        console.error('Invalid Stellar address:', error.details);
        break;
      case BatchErrorType.SEQUENCE_CONFLICT:
        console.error('Sequence conflict - service will auto-retry');
        break;
      case BatchErrorType.INSUFFICIENT_BALANCE:
        console.error('Not enough funds in source account');
        break;
      case BatchErrorType.TRANSACTION_FAILED:
        console.error('Transaction failed:', error.details);
        // Retry failed operations
        break;
    }
  }
}
```

## Performance Tips

### Optimal Batch Size

- **Small batches (1-50)**: Fast processing, low risk
- **Medium batches (50-100)**: Best balance of speed and efficiency
- **Large batches (>100)**: Use chunked processing

### Sequence Number Management

The service uses Redis to prevent conflicts:

```
Worker A: Lock → seq+1 → Submit → Unlock
Worker B:              Lock → seq+2 → Submit → Unlock
Worker C:                       Lock → seq+3 → Submit → Unlock
```

**Tips:**
- Keep `lockTimeoutSeconds` at 30s (default)
- Monitor Redis for lock contention
- Reduce concurrent workers if conflicts are frequent

### Fee Optimization

Stellar charges per operation, so batching saves on:
- **Network latency**: 1 transaction vs many
- **Sequence management**: Simpler conflict resolution
- **Error handling**: Single retry vs multiple

Example for 50 payments:
```
Individual: 50 transactions × ~5s = 250 seconds
Batch:      1 transaction × ~5s = 5 seconds
Savings:    98% faster!
```

## Monitoring

### Log Outputs

```
[Batch abc123] Starting batch payment with 10 operations
[Batch abc123] Attempt 1/3
[Batch abc123] Added payment operation 1: 10.5 to GBBBB...
[Batch abc123] Submitting transaction with 10 operations
[Batch abc123] Transaction successful: hash=..., fee=1000, ledger=12345
```

### Key Metrics to Track

- Batch success rate
- Average processing time
- Sequence conflict rate
- Fee per batch
- Retry rate

## Troubleshooting

### Issue: "Failed to acquire sequence lock"

**Cause**: Another worker is processing or Redis is down

**Solution**:
1. Check Redis connectivity: `redis-cli ping`
2. Reduce concurrent workers
3. Increase `lockTimeoutSeconds`

### Issue: "Transaction failed"

**Cause**: Insufficient balance, invalid addresses, or network issues

**Solution**:
1. Check source account balance
2. Validate all destination addresses
3. Verify asset trustlines exist
4. Check Horizon server status

### Issue: High retry rate

**Cause**: Too many concurrent workers or network instability

**Solution**:
1. Reduce worker count
2. Increase `retryDelayMs`
3. Check network connectivity to Horizon

## Next Steps

1. **Read the full documentation**: [BATCH_PAYMENT_README.md](./BATCH_PAYMENT_README.md)
2. **Review examples**: [batch-payment.examples.ts](./batch-payment.examples.ts)
3. **Run tests**: `npm test -- batch-payment.service.test.ts`
4. **Check API docs**: Start server and visit `http://localhost:3000/api-docs`

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review test cases for usage patterns
3. Examine example code in `batch-payment.examples.ts`
4. Check Stellar Horizon API documentation

## License

Part of the AnchorPoint project.
