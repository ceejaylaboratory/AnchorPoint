# Testing the Governance State Machine

## Overview
The Governance contract manages a highly sensitive, multi-phase lifecycle. To ensure absolute protocol safety, our test suite enforces strict state transitions and verifies storage invariants.

### Lifecycle Diagram
```text
[Draft] -> [Active] -> [Quorum Reached] -> [Execution Pending] -> [Executed]
   |          |               |                    |
   v          v               v                    v
[Cancelled] [Defeated]    [Defeated]            [Failed]
```

## Running the Test Suite
To run the full suite, including the standard state machine paths and the `proptest` fuzzers:
```bash
cargo test -p governance
```
To run specifically the fuzz tests with higher iterations (e.g., 10,000 cases):
```bash
PROPTEST_CASES=10000 cargo test -p governance --test fuzz_tests
```

## Writing New State Transition Tests
When adding new functionality (e.g., veto powers, delayed execution), ensure you write a dedicated test in `state_machine_tests.rs`. 
Always use the shared helpers from `storage_verification.rs`:
1. Use `assert_phase(&env, prop_id, Phase::Expected)` after triggering a transition.
2. Use `assert_vote_tally(&env, ...)` to guarantee vote arithmetic holds.
3. Call `env.ledger().set_sequence_number()` to explicitly control block progression.

## Storage Leaks (`assert_no_storage_leaks`)
Soroban charges state rent for persistent storage. A governance contract records individual votes (e.g., `Map<Address, Vote>`). If a proposal concludes (Executed or Defeated), these individual vote records **must be explicitly deleted** to refund rent. 
The `assert_no_storage_leaks` helper verifies that terminal state transitions clean up ephemeral maps, preventing silent rent bloat that would degrade protocol economics over time.
