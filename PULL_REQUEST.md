# Pull Request: Add Hardware Wallet Support for SEP-10 Authentication

## Overview

Extends AnchorPoint's SEP-10 implementation to support hardware wallets (Trezor, Ledger) by generating proper Stellar transactions for authentication challenges instead of simple string challenges.

## Motivation

Hardware wallets like Trezor and Ledger require signing actual Stellar transactions with specific structures and may use different signature algorithms or transaction formats. The previous implementation used simplified string challenges that software wallets could handle, but hardware wallets need proper Stellar transaction envelopes.

## Changes

### 1. SEP-10 Stellar Utilities
**File:** `backend/src/utils/sep10-stellar.ts`

- `generateSep10Challenge()`: Creates a proper Stellar transaction with manage_data operation containing the challenge
- `verifySep10Challenge()`: Parses and verifies signed SEP-10 transactions, checking signatures and challenge validity
- `extractAccountFromSep10Transaction()`: Extracts the account public key from signed transactions

### 2. Auth Service Updates
**File:** `backend/src/services/auth.service.ts`

- Added `generateSep10ChallengeTransaction()`: Generates SEP-10 challenge transactions for hardware wallets
- Added `storeSep10Challenge()`: Stores challenge data including transaction XDR
- Added `verifySep10ChallengeTransaction()`: Verifies signed transactions from hardware wallets
- Updated `Challenge` interface to include `transactionXdr` field
- Resolved merge conflicts between tracing and config service usage

### 3. Auth Controller Updates
**File:** `backend/src/api/controllers/auth.controller.ts`

- Updated `getChallenge()`: Now generates proper Stellar transactions instead of string challenges
- Updated `getToken()`: Verifies signed Stellar transactions and extracts account from transaction signatures
- Added support for network type configuration (testnet/public)

### 4. Environment Configuration
**File:** `backend/src/config/env.ts`

- Added `ANCHOR_PUBLIC_KEY` and `ANCHOR_SECRET_KEY` environment variables for anchor keypair configuration

### 5. Webhook Service Merge Conflict Resolution
**File:** `backend/src/services/webhook.service.ts`

- Resolved merge conflicts between tracing and config service implementations
- Updated to use config service for webhook configuration

### 6. Documentation Updates
**File:** `README.md`

- Updated SEP-10 section to mention hardware wallet support
- Added explanation of hardware wallet compatibility

## Technical Details

### SEP-10 Challenge Transaction Structure

The implementation follows SEP-10 specification:
- Source account: Anchor's public key
- Sequence number: 0
- Time bounds: 5-minute validity window
- Operations: Single manage_data operation with name `stellar.sep10.challenge`
- Network: Configurable (testnet/public)

### Hardware Wallet Compatibility

- **Trezor**: Supports Stellar transactions via Stellar app
- **Ledger**: Supports Stellar transactions via Stellar app
- Both devices sign transactions using ed25519 keys derived from BIP44 paths
- Transaction verification checks signature validity against the account public key

### Security Considerations

- Challenge transactions expire after 5 minutes
- Signed challenges are removed after successful verification to prevent replay attacks
- Proper signature verification ensures only valid signatures are accepted
- Time bounds prevent old challenges from being reused

## API Changes

**POST** `/auth`
- Request: `{ "account": "G..." }`
- Response: `{ "transaction": "base64-xdr", "network_passphrase": "..." }`

**POST** `/auth/token`
- Request: `{ "transaction": "signed-xdr" }`
- Response: `{ "token": "jwt", "type": "bearer", "expires_in": 3600 }`

## Testing

The implementation includes proper error handling for:
- Invalid transaction formats
- Expired challenges
- Invalid signatures
- Missing operations
- Wrong operation types

## Future Enhancements

- Support for custom derivation paths
- Multi-signature account support
- Integration with wallet connection libraries

- `page` — integer, default `1`
- `limit` — integer, default `10`, max `50`
- `assetCode` — optional asset code filter
- `sender` — optional search term for transaction sender metadata
- `receiver` — optional search term for transaction receiver metadata
- `memo` — optional search term for transaction memo metadata
- `cursor` — optional cursor-based pagination token

Response:

```json
{
  "status": "success",
  "data": {
    "transactions": [/* transaction records */],
    "pagination": {
      "total": 0,
      "page": 1,
      "limit": 10,
      "totalPages": 0
    }
  }
}
```

## Architecture & Flow

1. Authenticated request hits `/api/transactions`
2. Route validates query params
3. If event search terms are present (`sender`, `receiver`, `memo`):
   - query `ContractEvent` index for matching `txHash`
   - build a scoped `stellarTxId` filter
4. Query `Transaction` table for the authenticated user with all supplied filters
5. Return paginated transaction results

## Notes

- Search uses SQL `LIKE` on stored `ContractEvent.topics` and `ContractEvent.value`.
- This is intended for high-performance lookups when event metadata is already indexed.
- If no matching events are found, the route returns an empty result set immediately.

## Testing

Run the updated route test:

```bash
cd backend
npm test -- --runInBand src/api/routes/transactions.route.test.ts
```

## Related Files

- `backend/src/api/routes/transactions.route.ts`
- `backend/src/api/routes/transactions.route.test.ts`

## Checklist

- [x] Added search params `sender`, `receiver`, `memo`
- [x] Integrated event-indexed lookup for Stellar transaction hashes
- [x] Preserved authenticated user transaction scoping
- [x] Added route tests for indexed search path
- [ ] Verified full backend test suite is blocked by unrelated merge conflicts in `backend/src/services/auth.service.ts`

## Reviewers Notes

- If the `sender`/`receiver`/`memo` filters are used without matching events, the route returns an empty paginated response.
- Existing transaction history queries still work when only `assetCode`, `page`, or `cursor` are provided.
- The implementation assumes `ContractEvent` events are already indexed by the service.

## Questions?

- Do we want to support exact matching vs partial matching for `sender`/`receiver`/`memo` in a future iteration?
- Should the API add normalized event metadata columns to the transaction table later for even faster search?
