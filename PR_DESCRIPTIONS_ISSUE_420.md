# PR Description for Issue #420: SEP-40 Robust Case Handling

**Branch:** `issue-420-sep40-case-handling`

**Description:**
This PR implements robust case handling and validation for asset codes in the SEP-40 swap rates API. The previous implementation had limited validation and could fail silently with malformed input.

## Changes Made:
- Added `normalizeAssetCode` helper method with comprehensive validation
- Handles whitespace, invalid characters, and edge cases
- Returns null for invalid asset codes instead of proceeding with bad data
- Updated `getSwapRate` to use the new normalization method

**Files modified:**
- `backend/src/api/controllers/sep40.controller.ts`

**Testing:**
- Updated existing test suite to verify case handling behavior
- Added new test cases for edge cases including whitespace and special characters

**References:**
- Fixes #420
- Related to SEP-40 specification requirements for consistent asset code handling
