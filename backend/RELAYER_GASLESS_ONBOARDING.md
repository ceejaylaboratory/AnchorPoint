# Gasless Token Approval System

A signature-based verification system that allows a relayer to submit token approvals on behalf of a user, facilitating gasless onboarding for new users.

## Overview

This system enables users to sign token approval requests without paying transaction fees. The relayer verifies the signature and submits the transaction on the user's behalf, paying the gas fees. This is particularly useful for onboarding new users who may not have XLM to pay for transactions.

## Architecture

### Components

1. **Relayer Service** (`backend/src/services/relayer.service.ts`)
   - Signature verification
   - Transaction building
   - Transaction submission

2. **Relayer Controller** (`backend/src/api/controllers/relayer.controller.ts`)
   - API endpoints for approval requests
   - Signature verification endpoint
   - Nonce generation

3. **Relayer Types** (`backend/src/types/relayer.types.ts`)
   - Type definitions for requests and responses
   - Configuration interfaces

## Configuration

### Environment Variables

Add the following to your `.env` file:

```bash
# Relayer Configuration
RELAYER_PUBLIC_KEY=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
RELAYER_SECRET_KEY=SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
RELAYER_MAX_AMOUNT=1000000
RELAYER_ALLOWED_SPENDERS=GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB,GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
RELAYER_EXPIRY_WINDOW=3600
```

**Environment Variable Descriptions:**

- `RELAYER_PUBLIC_KEY`: The relayer's Stellar public key
- `RELAYER_SECRET_KEY`: The relayer's Stellar secret key (keep secure!)
- `RELAYER_MAX_AMOUNT`: Maximum amount allowed per approval (in stroops)
- `RELAYER_ALLOWED_SPENDERS`: Comma-separated list of allowed spender addresses
- `RELAYER_EXPIRY_WINDOW`: Time window in seconds for approval validity (default: 3600 = 1 hour)

## API Endpoints

### 1. Submit Token Approval

**POST** `/api/relayer/approve`

Submit a token approval request with a signature. The relayer verifies the signature and submits the transaction.

**Request Body:**
```json
{
  "userPublicKey": "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "spenderPublicKey": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "amount": "1000000",
  "assetCode": "USDC",
  "assetIssuer": "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
  "nonce": "550e8400-e29b-41d4-a716-446655440000",
  "expiry": 1714324800000,
  "signature": "base64-encoded-signature"
}
```

**Response:**
```json
{
  "success": true,
  "transactionHash": "abc123...",
  "message": "Token approval submitted successfully"
}
```

### 2. Verify Signature

**POST** `/api/relayer/verify`

Verify a signature without submitting the transaction. Useful for pre-verification.

**Request Body:**
```json
{
  "userPublicKey": "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "spenderPublicKey": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "amount": "1000000",
  "nonce": "550e8400-e29b-41d4-a716-446655440000",
  "expiry": 1714324800000,
  "signature": "base64-encoded-signature"
}
```

**Response:**
```json
{
  "valid": true,
  "publicKey": "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
}
```

### 3. Submit Signed Transaction

**POST** `/api/relayer/submit`

Submit a pre-signed transaction. The transaction should already be signed by the user.

**Request Body:**
```json
{
  "signedTransactionXdr": "base64-encoded-xdr",
  "networkPassphrase": "Test SDF Network ; September 2015"
}
```

**Response:**
```json
{
  "success": true,
  "transactionHash": "abc123...",
  "message": "Transaction submitted successfully"
}
```

### 4. Generate Nonce

**GET** `/api/relayer/nonce`

Generate a unique nonce for approval requests. Nonces prevent replay attacks.

**Response:**
```json
{
  "nonce": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Nonce generated successfully"
}
```

### 5. Get Relayer Configuration

**GET** `/api/relayer/config`

Get public relayer configuration (excludes sensitive data like secret key).

**Response:**
```json
{
  "relayerPublicKey": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "maxAmount": "1000000",
  "allowedSpenders": [
    "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
  ],
  "expiryWindowSeconds": 3600
}
```

## Integration Guide

### Client-Side Implementation

#### Step 1: Generate a Nonce

```typescript
const response = await fetch('http://localhost:3002/api/relayer/nonce');
const { nonce } = await response.json();
```

#### Step 2: Construct the Approval Message

The message format is:
```
approve|{userPublicKey}|{spenderPublicKey}|{amount}|{assetCode}|{assetIssuer}|{nonce}|{expiry}
```

```typescript
const message = `approve|${userPublicKey}|${spenderPublicKey}|${amount}|${assetCode}|${assetIssuer}|${nonce}|${expiry}`;
```

#### Step 3: Sign the Message

Using the Stellar SDK:

```typescript
import { Keypair } from '@stellar/stellar-sdk';

const userKeypair = Keypair.fromSecret(userSecretKey);
const signature = userKeypair.sign(Buffer.from(message)).toString('base64');
```

#### Step 4: Submit the Approval Request

```typescript
const approvalRequest = {
  userPublicKey,
  spenderPublicKey,
  amount,
  assetCode,
  assetIssuer,
  nonce,
  expiry: Date.now() + 3600000, // 1 hour from now
  signature,
};

const response = await fetch('http://localhost:3002/api/relayer/approve', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(approvalRequest),
});

const result = await response.json();
```

## Security Considerations

### Signature Verification

The system verifies:
- Signature validity using Ed25519
- Request expiration (prevents replay attacks)
- Spender authorization (only approved spenders)
- Amount limits (prevents excessive approvals)

### Nonce Usage

- Each approval request must include a unique nonce
- Nonces are generated by the server to ensure uniqueness
- Nonces prevent replay attacks

### Expiry Window

- Approval requests expire after the configured window (default: 1 hour)
- Expired requests are rejected automatically

### Allowed Spenders

- Configure a whitelist of allowed spender addresses
- Only spenders in the whitelist can receive approvals
- This prevents unauthorized approvals to unknown addresses

### Amount Limits

- Maximum approval amount is configurable
- Prevents users from approving excessively large amounts
- Protects against potential exploits

## Error Handling

### Common Errors

**Invalid Signature**
```json
{
  "success": false,
  "error": "Invalid signature"
}
```

**Expired Request**
```json
{
  "success": false,
  "error": "Request has expired"
}
```

**Unauthorized Spender**
```json
{
  "success": false,
  "error": "Spender is not authorized"
}
```

**Amount Exceeds Maximum**
```json
{
  "success": false,
  "error": "Amount exceeds maximum allowed"
}
```

## Testing

Run the test suite:

```bash
npm test -- relayer.service.test.ts
```

## Use Cases

### 1. New User Onboarding

New users without XLM can approve token spending without paying gas fees:
1. User signs approval request
2. Relayer verifies and submits
3. Relayer pays the transaction fee
4. User can now interact with the application

### 2. DeFi Integration

DeFi protocols can use this for:
- Token approvals without gas costs
- Batch approvals for multiple tokens
- Automated approval workflows

### 3. Payment Processing

Payment processors can:
- Request token approvals from users
- Submit approvals on behalf of users
- Enable seamless payment experiences

## Best Practices

1. **Always use HTTPS** in production to prevent man-in-the-middle attacks
2. **Rotate relayer keys** regularly to minimize exposure
3. **Monitor approval activity** for suspicious patterns
4. **Set appropriate amount limits** based on your use case
5. **Use short expiry windows** for high-value approvals
6. **Implement rate limiting** on approval endpoints
7. **Log all approval requests** for audit trails

## Troubleshooting

### Transaction Submission Fails

If transaction submission fails:
1. Check that the relayer has sufficient XLM balance
2. Verify the network configuration matches the target network
3. Ensure the relayer account is funded and active
4. Check Horizon service status

### Signature Verification Fails

If signature verification fails:
1. Ensure the message format matches exactly
2. Verify the signature is base64 encoded
3. Check that the correct user keypair is used for signing
4. Confirm the nonce is fresh and unused

### Spender Not Authorized

If spender is not authorized:
1. Add the spender address to `RELAYER_ALLOWED_SPENDERS`
2. Restart the backend service
3. Verify the spender address is correct

## Future Enhancements

Potential improvements:
- Multi-signature support
- Batch approval requests
- Approval revocation
- Time-locked approvals
- Conditional approvals
- Approval history tracking
- Webhook notifications for approvals
