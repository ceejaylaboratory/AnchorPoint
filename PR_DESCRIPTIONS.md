# PR Descriptions for AnchorPoint Issues

## Issue #390: SEP-40 Swap Rates Improvements

**Branch:** `issue-390-sep40-improvements`

**Description:**
This PR implements several improvements to the SEP-40 swap rates functionality:

- Added in-memory caching for swap rates with 5-minute TTL to improve performance
- Enhanced error handling and validation for invalid asset pairs
- Added rate validation to prevent extreme/unreasonable swap rates
- Improved logging for debugging and monitoring
- Better error responses for unsupported asset combinations

**Files modified:**
- `backend/src/api/controllers/sep40.controller.ts`

## Issue #351: SEP-24 Security Improvements

**Branch:** `issue-351-sep24-security`

**Description:**
This PR enhances the security of SEP-24 endpoints with the following improvements:

- Added sensitive API rate limiting to deposit, withdrawal, and interactive validation endpoints
- Implemented Stellar account address validation using regex pattern matching
- Added comprehensive security logging for invalid requests and suspicious activity
- Enhanced input validation for asset codes and account addresses

**Files modified:**
- `backend/src/api/routes/sep24.route.ts`

## Issue #358: SEP-31 Transaction Status Improvements

**Branch:** `issue-358-sep31-transactions`

**Description:**
This PR improves SEP-31 transaction status tracking and monitoring:

- Added additional status tracking fields including `last_status_update` and `status_history`
- Enhanced transaction retrieval to include detailed status information
- Improved error handling and logging for transaction status operations
- Better validation for status transitions

**Files modified:**
- `backend/src/services/sep31.service.ts`
- `backend/src/api/controllers/sep31.controller.ts`

## Issue #353: SEP-10 Hardware Wallet Compatibility

**Branch:** `issue-353-sep10-hardware-wallet`

**Description:**
This PR adds hardware wallet compatibility improvements for SEP-10 authentication:

- Added hardware wallet signature validation function
- Enhanced logging for hardware wallet detection
- Improved error handling for hardware wallet specific signing patterns
- Added validation for Trezor/Ledger specific signatures

**Files modified:**
- `backend/src/api/controllers/auth.controller.ts`

## How to Create PRs

1. Go to the GitHub repository: https://github.com/ceejaylaboratory/AnchorPoint
2. Click on "Pull requests" → "New pull request"
3. Select the appropriate branch for each PR
4. Use the descriptions above as the PR description
5. Reference the corresponding GitHub issue in the PR description (e.g., "Fixes #390")
6. Submit each PR separately