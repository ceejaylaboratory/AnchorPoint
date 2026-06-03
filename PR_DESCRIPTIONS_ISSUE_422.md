# PR Description for Issue #422: SEP-40 Dynamic Rate Precision

**Branch:** `issue-422-sep40-rate-precision`

**Description:**
This PR implements dynamic decimal precision for swap rates based on the magnitude of the rate value. The previous implementation used a fixed 7 decimal places for all rates, which was suboptimal for both very small and very large values.

## Changes Made:
- Added dynamic precision calculation in `getSwapRate` method
- Rates < 0.001 get 10 decimals, < 0.01 get 9 decimals, < 0.1 get 8 decimals
- Rates >= 1000 get 2 decimals, >= 100 get 3 decimals, >= 10 get 4 decimals
- Maintains backward compatibility while improving precision where needed

**Files modified:**
- `backend/src/api/controllers/sep40.controller.ts`

**Testing:**
- Updated existing tests to verify precision behavior
- Added new test cases for edge cases with different rate magnitudes

**References:**
- Fixes #422
- Related to SEP-40 specification requirements for accurate rate representation
