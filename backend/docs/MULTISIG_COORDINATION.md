# Multi-signature Transaction Coordination Service

## Overview

The Multi-signature Transaction Coordination Service provides a comprehensive solution for managing Stellar transactions that require signatures from multiple parties. It handles transaction storage, signature collection, notification management, and automatic submission once the signature threshold is reached.

## Features

### 1. Transaction Repository
- Store transaction envelopes (XDR format)
- Track transaction status throughout the signing process
- Support for transaction expiration
- Metadata storage for additional context

### 2. Signature Management
- Collect signatures from multiple parties
- Validate signatures against required signers
- Merge signatures into a single transaction envelope
- Prevent duplicate signatures

### 3. Notification System
- Notify required signers when their signature is needed
- Alert signers when new signatures are added
- Notify all parties when threshold is reached
- Inform about successful submission or failures

### 4. Automatic Submission
- Automatically submit transactions when threshold is reached
- Retry logic for failed submissions
- Track submission status on Stellar network

## Architecture

### Database Models

#### MultisigTransaction
Stores the main transaction information:
- `id`: Unique identifier
- `envelopeXdr`: Base64 encoded transaction envelope
- `hash`: Transaction hash for verification
- `creatorPublicKey`: Who initiated the transaction
- `requiredSigners`: Array of public keys that must sign
- `threshold`: Number of signatures required
- `currentSignatures`: Current number of signatures collected
- `status`: Transaction status (PENDING, PARTIALLY_SIGNED, READY, SUBMITTED, FAILED, EXPIRED)
- `expiresAt`: Optional expiration timestamp
- `stellarTxId`: Stellar network transaction ID after submission
- `metadata`: Additional custom data

#### MultisigSignature
Tracks individual signatures:
- `id`: Unique identifier
- `multisigTransactionId`: Reference to parent transaction
- `signerPublicKey`: Who signed
- `signature`: Base64 encoded signature
- `signedAt`: Timestamp of signature

#### MultisigNotification
Manages notifications to signers:
- `id`: Unique identifier
- `multisigTransactionId`: Reference to transaction
- `recipientPublicKey`: Who receives the notification
- `type`: Notification type (SIGNATURE_REQUIRED, SIGNATURE_ADDED, etc.)
- `message`: Notification message
- `sentAt`: When notification was sent
- `readAt`: When notification was read (null if unread)

### Transaction Status Flow

```
PENDING → PARTIALLY_SIGNED → READY → SUBMITTED
                                   ↓
                                FAILED
                                   ↓
                                EXPIRED
```

- **PENDING**: Newly created, no signatures yet
- **PARTIALLY_SIGNED**: Some signatures collected, below threshold
- **READY**: Threshold reached, ready for submission
- **SUBMITTED**: Successfully submitted to Stellar network
- **FAILED**: Submission to Stellar network failed
- **EXPIRED**: Transaction expired before reaching threshold

## API Endpoints

### Create Multisig Transaction

```http
POST /api/multisig/transactions
Authorization: Bearer <token>
Content-Type: application/json

{
  "envelopeXdr": "AAAAAA...",
  "requiredSigners": [
    "GXXXXXX...",
    "GXXXXXX...",
    "GXXXXXX..."
  ],
  "threshold": 2,
  "memo": "Payment for services",
  "expiresAt": "2024-12-31T23:59:59Z",
  "metadata": {
    "purpose": "vendor_payment",
    "amount": "1000 USDC"
  }
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "transaction": {
      "id": "uuid",
      "hash": "abc123...",
      "status": "PENDING",
      "currentSignatures": 0,
      "threshold": 2,
      "requiredSigners": ["GXXX...", "GXXX...", "GXXX..."],
      "createdAt": "2024-01-01T00:00:00Z"
    }
  }
}
```

### Add Signature

```http
POST /api/multisig/transactions/{transactionId}/sign
Authorization: Bearer <token>
Content-Type: application/json

{
  "signedEnvelopeXdr": "AAAAAA..."
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "transaction": {
      "id": "uuid",
      "status": "PARTIALLY_SIGNED",
      "currentSignatures": 1,
      "threshold": 2,
      "signatures": [
        {
          "signerPublicKey": "GXXX...",
          "signedAt": "2024-01-01T00:00:00Z"
        }
      ]
    }
  }
}
```

### Get Transaction Details

```http
GET /api/multisig/transactions/{transactionId}
Authorization: Bearer <token>
```

### Get My Transactions

```http
GET /api/multisig/transactions?status=PENDING
Authorization: Bearer <token>
```

### Get Pending Transactions

```http
GET /api/multisig/pending
Authorization: Bearer <token>
```

Returns transactions that need the authenticated user's signature.

### Submit Transaction

```http
POST /api/multisig/transactions/{transactionId}/submit
Authorization: Bearer <token>
```

Manually trigger submission of a transaction that has reached threshold.

### Get Notifications

```http
GET /api/multisig/notifications?unreadOnly=true
Authorization: Bearer <token>
```

### Mark Notifications as Read

```http
POST /api/multisig/notifications/read
Authorization: Bearer <token>
Content-Type: application/json

{
  "notificationIds": ["uuid1", "uuid2"]
}
```

## Usage Examples

### Example 1: Simple 2-of-3 Multisig Payment

```typescript
import * as StellarSdk from '@stellar/stellar-sdk';

// Step 1: Create the transaction
const sourceKeypair = StellarSdk.Keypair.fromSecret('SXXX...');
const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
const account = await server.loadAccount(sourceKeypair.publicKey());

const transaction = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: StellarSdk.Networks.TESTNET,
})
  .addOperation(
    StellarSdk.Operation.payment({
      destination: 'GDEST...',
      asset: StellarSdk.Asset.native(),
      amount: '100',
    })
  )
  .setTimeout(300)
  .build();

const envelopeXdr = transaction.toEnvelope().toXDR('base64');

// Step 2: Create multisig transaction via API
const response = await fetch('/api/multisig/transactions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    envelopeXdr,
    requiredSigners: [
      'GSIGNER1...',
      'GSIGNER2...',
      'GSIGNER3...',
    ],
    threshold: 2,
    memo: 'Team payment',
  }),
});

const { data } = await response.json();
console.log('Transaction created:', data.transaction.id);

// Step 3: Each signer signs the transaction
const signer1Keypair = StellarSdk.Keypair.fromSecret('SSIGNER1...');
const txToSign = StellarSdk.TransactionBuilder.fromXDR(
  envelopeXdr,
  StellarSdk.Networks.TESTNET
);

txToSign.sign(signer1Keypair);
const signedXdr = txToSign.toEnvelope().toXDR('base64');

// Step 4: Submit signature via API
await fetch(`/api/multisig/transactions/${data.transaction.id}/sign`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${signer1Token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    signedEnvelopeXdr: signedXdr,
  }),
});

// Step 5: Second signer signs (threshold reached, auto-submitted)
const signer2Keypair = StellarSdk.Keypair.fromSecret('SSIGNER2...');
txToSign.sign(signer2Keypair);
const signed2Xdr = txToSign.toEnvelope().toXDR('base64');

await fetch(`/api/multisig/transactions/${data.transaction.id}/sign`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${signer2Token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    signedEnvelopeXdr: signed2Xdr,
  }),
});

// Transaction is automatically submitted to Stellar network!
```

### Example 2: Treasury Management with Expiration

```typescript
// Create a transaction that expires in 24 hours
const expiresAt = new Date();
expiresAt.setHours(expiresAt.getHours() + 24);

const response = await fetch('/api/multisig/transactions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    envelopeXdr,
    requiredSigners: [
      'GCFO...',  // CFO
      'GCEO...',  // CEO
      'GCTO...',  // CTO
    ],
    threshold: 2,
    memo: 'Q4 vendor payment',
    expiresAt: expiresAt.toISOString(),
    metadata: {
      department: 'engineering',
      budget: 'Q4-2024',
      vendor: 'AWS',
      amount: '50000 USDC',
    },
  }),
});
```

### Example 3: Check Pending Transactions

```typescript
// Get all transactions waiting for my signature
const response = await fetch('/api/multisig/pending', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});

const { data } = await response.json();

for (const tx of data.transactions) {
  console.log(`Transaction ${tx.id}:`);
  console.log(`  Status: ${tx.status}`);
  console.log(`  Signatures: ${tx.currentSignatures}/${tx.threshold}`);
  console.log(`  Memo: ${tx.memo}`);
  console.log(`  Expires: ${tx.expiresAt}`);
}
```

### Example 4: Monitor Notifications

```typescript
// Get unread notifications
const response = await fetch('/api/multisig/notifications?unreadOnly=true', {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});

const { data } = await response.json();

for (const notification of data.notifications) {
  console.log(`[${notification.type}] ${notification.message}`);
  
  if (notification.type === 'SIGNATURE_REQUIRED') {
    // Handle signature request
    await handleSignatureRequest(notification.multisigTransaction);
  }
}

// Mark as read
await fetch('/api/multisig/notifications/read', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    notificationIds: data.notifications.map(n => n.id),
  }),
});
```

## Best Practices

### 1. Transaction Creation

- **Set appropriate thresholds**: Balance security with convenience
- **Use expiration dates**: Prevent stale transactions from accumulating
- **Add meaningful memos**: Help signers understand what they're signing
- **Include metadata**: Store context for auditing and tracking

### 2. Signature Collection

- **Verify transaction details**: Always review before signing
- **Sign promptly**: Don't delay other signers
- **Check expiration**: Ensure transaction hasn't expired
- **Validate signers**: Confirm you're a required signer

### 3. Security

- **Protect private keys**: Never share or expose secret keys
- **Verify transaction hash**: Ensure you're signing the correct transaction
- **Use secure channels**: Communicate transaction details securely
- **Audit regularly**: Review multisig transactions periodically

### 4. Error Handling

- **Handle expired transactions**: Recreate if necessary
- **Retry failed submissions**: Check Stellar network status
- **Monitor notifications**: Stay informed of transaction status
- **Log all actions**: Maintain audit trail

## Notification Types

### SIGNATURE_REQUIRED
Sent when a new multisig transaction is created to all required signers.

### SIGNATURE_ADDED
Sent to all signers (except the one who just signed) when a new signature is added.

### THRESHOLD_REACHED
Sent to all signers when the signature threshold is reached and transaction is ready for submission.

### SUBMITTED
Sent to all signers when the transaction is successfully submitted to the Stellar network.

### FAILED
Sent to all signers if transaction submission fails.

## Troubleshooting

### Transaction Not Submitting

**Problem**: Transaction reaches threshold but doesn't submit.

**Solutions**:
1. Check Stellar network status
2. Verify transaction hasn't expired
3. Manually trigger submission via `/submit` endpoint
4. Check transaction validity (sequence numbers, etc.)

### Signature Rejected

**Problem**: Signature is rejected when adding to transaction.

**Solutions**:
1. Verify you're a required signer
2. Check transaction hash matches
3. Ensure you haven't already signed
4. Verify transaction hasn't expired or been submitted

### Missing Notifications

**Problem**: Not receiving notifications about transactions.

**Solutions**:
1. Check notification endpoint regularly
2. Verify your public key is in required signers
3. Implement webhook for real-time notifications
4. Check notification read status

## Performance Considerations

### Database Indexes

The schema includes indexes on:
- Transaction hash (for quick lookups)
- Creator public key (for user queries)
- Transaction status (for filtering)
- Expiration date (for cleanup jobs)
- Signer public key (for signature lookups)

### Cleanup Jobs

Implement periodic cleanup for:
- Expired transactions
- Old notifications
- Completed transactions (archive after 90 days)

### Caching

Consider caching:
- Pending transaction counts per user
- Unread notification counts
- Recent transaction history

## Integration with Frontend

### React Example

```typescript
import { useState, useEffect } from 'react';

function PendingTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPendingTransactions();
  }, []);

  const fetchPendingTransactions = async () => {
    const response = await fetch('/api/multisig/pending', {
      headers: {
        'Authorization': `Bearer ${getToken()}`,
      },
    });
    const { data } = await response.json();
    setTransactions(data.transactions);
    setLoading(false);
  };

  const signTransaction = async (txId, signedXdr) => {
    await fetch(`/api/multisig/transactions/${txId}/sign`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ signedEnvelopeXdr: signedXdr }),
    });
    
    // Refresh list
    fetchPendingTransactions();
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Pending Signatures ({transactions.length})</h2>
      {transactions.map(tx => (
        <TransactionCard
          key={tx.id}
          transaction={tx}
          onSign={signTransaction}
        />
      ))}
    </div>
  );
}
```

## Future Enhancements

1. **Webhook Support**: Real-time notifications via webhooks
2. **Email Notifications**: Send email alerts to signers
3. **Mobile Push Notifications**: Alert mobile app users
4. **Transaction Templates**: Reusable transaction patterns
5. **Approval Workflows**: Multi-stage approval processes
6. **Analytics Dashboard**: Transaction metrics and insights
7. **Batch Operations**: Sign multiple transactions at once
8. **Smart Contract Integration**: Trigger smart contract actions

## Support

For issues or questions:
- Review this documentation
- Check API endpoint responses
- Examine transaction status and logs
- Create an issue in the repository
