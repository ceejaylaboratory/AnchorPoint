# PR Description for Issue #406: SEP-40 Enhanced Error Handling

**Branch:** `issue-406-sep40-error-handling`

**Description:**
This PR significantly enhances the error handling capabilities of the SEP-40 swap rates API. Previously, invalid asset pairs were silently ignored, making debugging difficult for clients. This implementation provides detailed error information in the response.

## Changes Made:
- Extended `SwapRateResponse` interface to include optional `errors` array
- Modified `getSwapRates` method to collect and return detailed error information
- Added validation for missing fields and specific error reasons
- Maintains backward compatibility by making errors optional in the response

**Files modified:**
- `backend/src/api/controllers/sep40.controller.ts`

**Testing:**
- Updated existing test suite to verify error handling behavior
- Added new test cases for various error scenarios

**References:**
- Fixes #406
- Related to SEP-40 specification requirements for robust error reporting
