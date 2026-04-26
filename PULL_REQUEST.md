# Pull Request: Add Hardware Wallet Support for SEP-10 Authentication

## Overview

This PR extends AnchorPoint's SEP-10 authentication flow to support hardware wallets such as Trezor and Ledger. It does so by generating and validating SEP-10 compliant Stellar challenge transactions instead of simplified string challenges.

## Motivation

Hardware wallets require a real Stellar transaction envelope to sign, not a plain string. Existing software-wallet-friendly challenge handling did not provide the transaction structure and signature validation semantics needed for hardware-wallet compatibility.

## What Changed

### 1. SEP-10 Transaction Utilities
**File:** `backend/src/utils/sep10-stellar.ts`

- Added challenge generation for SEP-10 authentication transactions
- Added verification of signed SEP-10 transactions
- Added account extraction from signed transaction XDR

### 2. Auth Service Enhancements
**File:** `backend/src/services/auth.service.ts`

- Added `generateSep10ChallengeTransaction()` to produce a proper Stellar challenge transaction
- Added `storeSep10Challenge()` to persist challenge metadata and XDR for verification
- Added `verifySep10ChallengeTransaction()` to validate signed transaction format, challenge, and signature
- Updated challenge storage model to include transaction XDR
- Kept existing JWT signing flow intact

### 3. Auth Controller Updates
**File:** `backend/src/api/controllers/auth.controller.ts`

- `getChallenge()` now returns a `transaction` XDR and `network_passphrase`
- `getToken()` now verifies the signed transaction, extracts the account, and returns a JWT
- Added network-type handling for `testnet` and `public`

### 4. Config Updates
**File:** `backend/src/config/env.ts`

- Added optional environment variables for anchor key configuration:
  - `ANCHOR_PUBLIC_KEY`
  - `ANCHOR_SECRET_KEY`

### 5. Documentation
**File:** `README.md`

- Clarified SEP-10 support for Trezor and Ledger hardware wallets
- Explained how the backend now generates proper challenge transactions

## Technical Details

- Challenge transactions use `manage_data` with name `stellar.sep10.challenge`
- Source account is the anchor public key
- Sequence number is `0` per SEP-10 requirements
- Time bounds are set to a 5-minute validity window
- Verification checks:
  - single operation exists
  - operation is `manage_data`
  - challenge value matches stored challenge
  - signature validates against the signing account

## API Behavior

### `POST /auth`

Request:

```json
{ "account": "G..." }
```

Response:

```json
{
  "transaction": "<base64-xdr>",
  "network_passphrase": "<network-passphrase>"
}
```

### `POST /auth/token`

Request:

```json
{ "transaction": "<signed-xdr>" }
```

Response:

```json
{
  "token": "<jwt>",
  "type": "bearer",
  "expires_in": 3600
}
```

## Testing

The implementation includes validation for:
- malformed or invalid transaction XDR
- expired or missing challenge data
- invalid operation type
- wrong challenge payload
- signature verification failure

## Notes for Reviewers

- This change is scoped to SEP-10 authentication only and does not alter SEP-24 or SEP-12 flows.
- The backend retains the existing JWT issuance strategy, using the challenge transaction only for authentication.
- Hardware wallets now receive a proper transaction envelope they can sign, improving compatibility with Trezor and Ledger.

## Files Changed

- `backend/src/utils/sep10-stellar.ts`
- `backend/src/services/auth.service.ts`
- `backend/src/api/controllers/auth.controller.ts`
- `backend/src/config/env.ts`
- `backend/src/services/webhook.service.ts` (merge conflict cleanup)
- `README.md`

## Future Improvements

- Add explicit support for custom derivation paths in wallet integrations
- Add multi-signature SEP-10 support for hardware-backed multisig accounts
- Integrate with wallet connection libraries for better UX

## Checklist

- [x] Generate SEP-10 challenge transaction XDR
- [x] Store challenge metadata and XDR for verification
- [x] Verify signatures from hardware wallets
- [x] Support both `testnet` and `public` networks
- [x] Document hardware wallet support

