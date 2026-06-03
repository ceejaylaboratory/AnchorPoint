# Implementation Plan - Flash Loan Formal Verification

This plan outlines the steps to address issue #126: Contract: Formal Verification of Flash Loan Logic.

## Objectives
1.  **Harden Flash Loan Logic**: Fix potential overflow/underflow issues in fee calculations and repayment checks.
2.  **Formal Verification**: Add Kani proofs to verify the correctness of the logic, specifically:
    *   Overflow/underflow safety.
    *   Atomic repayment enforcement.
    *   Absence of reentrancy vulnerabilities (architectural check).

## Proposed Changes

### 1. `src/flash_loan/lib.rs`
*   Replace standard arithmetic with checked arithmetic for fee calculations and repayment checks.
*   Ensure the contract handles potential errors gracefully (e.g., panicking on overflow).

### 2. `src/flash_loan/verification.rs` (New File)
*   Implement Kani proofs to verify the logic.
*   Focus on the `fee` calculation and the `repayment` logic.

## Verification Strategy
*   Use `kani` to prove that the fee calculation never overflows for valid inputs.
*   Use `kani` to prove that the repayment condition correctly enforces that the balance must increase by at least the fee.
*   Run existing tests to ensure no regressions.

## Schedule
1.  Harden `lib.rs`.
2.  Create `verification.rs` with Kani proofs.
3.  Update `Cargo.toml` if needed for Kani dependencies.
