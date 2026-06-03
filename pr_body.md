## Description

This pull request consolidates multiple enhancements and features into a single update. It addresses the following improvements:

- **SEP-40 Swap Rates Improvements**: Added in-memory caching for swap rates with a 5-minute TTL to improve performance, enhanced error handling and validation for invalid asset pairs, added rate validation to prevent extreme/unreasonable swap rates, and improved logging and error responses.
- **SEP-24 Security Improvements**: Added sensitive API rate limiting to deposit, withdrawal, and interactive validation endpoints. Implemented Stellar account address validation using regex pattern matching, along with comprehensive security logging and enhanced input validation.
- **SEP-31 Transaction Status Improvements**: Improved transaction status tracking and monitoring by adding `last_status_update` and `status_history` fields. Enhanced transaction retrieval, error handling, logging, and validation for status transitions.
- **SEP-10 Hardware Wallet Compatibility**: Added hardware wallet signature validation, enhanced logging for hardware wallet detection, and improved error handling for specific signing patterns (Trezor/Ledger).

Closes #390
Closes #351
Closes #358
Closes #353
