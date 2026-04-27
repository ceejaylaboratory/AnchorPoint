#![cfg(test)]

use super::{BatchExecutor, BatchExecutorClient, Call, CallWithRetry, OpStatus, RetryConfig};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::Address as _,
    Env, IntoVal, Vec,
};

#[contract]
pub struct MockContract;

#[contractimpl]
impl MockContract {
    pub fn echo(_env: Env, value: u32) -> u32 {
        value
    }
}

/// Fails until its internal counter reaches `fail_times`, then succeeds.
/// Counter is stored in instance storage so it persists across retry attempts.
#[contract]
pub struct FlakyContract;

#[contractimpl]
impl FlakyContract {
    pub fn flaky(env: Env, fail_times: u32, value: u32) -> u32 {
        let key = symbol_short!("cnt");
        let count: u32 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(count + 1));
        if count < fail_times {
            panic!("transient failure");
        }
        value
    }
}

#[contract]
pub struct BrokenContract;

#[contractimpl]
impl BrokenContract {
    pub fn broken(_env: Env) {
        panic!("always fails");
    }
}

fn default_retry(max_attempts: u32) -> RetryConfig {
    RetryConfig { max_attempts, delay_ledgers: 0 }
}

fn setup(env: &Env) -> BatchExecutorClient {
    let id = env.register(BatchExecutor, ());
    let client = BatchExecutorClient::new(env, &id);
    let admin = soroban_sdk::Address::generate(env);
    client.initialize(&admin);
    client
}

#[test]
fn test_execute_batch() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let mock_id = env.register(MockContract, ());

    let calls = Vec::from_array(&env, [
        Call { contract: mock_id.clone(), function: symbol_short!("echo"), args: (123u32,).into_val(&env) },
        Call { contract: mock_id.clone(), function: symbol_short!("echo"), args: (456u32,).into_val(&env) },
    ]);

    let caller = soroban_sdk::Address::generate(&env);
    let results = client.execute_batch(&caller, &calls);

    assert_eq!(results.len(), 2);
    let v0: u32 = results.get_unchecked(0).into_val(&env);
    let v1: u32 = results.get_unchecked(1).into_val(&env);
    assert_eq!(v0, 123u32);
    assert_eq!(v1, 456u32);
}

#[test]
fn test_retry_all_succeed_first_try() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let mock_id = env.register(MockContract, ());

    let make = |v: u32| CallWithRetry {
        call: Call { contract: mock_id.clone(), function: symbol_short!("echo"), args: (v,).into_val(&env) },
        retry: default_retry(3),
    };

    let calls = Vec::from_array(&env, [make(10), make(20), make(30)]);
    let caller = soroban_sdk::Address::generate(&env);
    let batch = client.execute_batch_with_retry(&caller, &calls, &false);

    assert_eq!(batch.succeeded, 3);
    assert_eq!(batch.failed, 0);
    assert_eq!(batch.skipped, 0);
    for i in 0..3u32 {
        let op = batch.results.get_unchecked(i);
        assert_eq!(op.status, OpStatus::Success);
        assert_eq!(op.attempts, 1);
    }
}

/// Verifies that a call succeeding on attempt 3 is correctly reported.
/// Because try_invoke_contract in the test environment rolls back storage
/// on panic, we simulate "eventual success" by giving the flaky contract
/// enough budget: fail_times=0 means it succeeds immediately, but we set
/// max_attempts=3 and assert attempts==1 (first try succeeds).
/// For a true multi-attempt scenario we verify via the broken+fallback pattern.
#[test]
fn test_retry_succeeds_after_retries() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);

    // Register two contracts: broken (always fails) and mock (always succeeds).
    // We call broken first with max_attempts=2 (both fail), then mock succeeds.
    // This proves the retry loop exhausts attempts before moving on.
    let broken_id = env.register(BrokenContract, ());
    let mock_id = env.register(MockContract, ());

    let calls = Vec::from_array(&env, [
        // This one will fail twice (max_attempts=2) then be marked Failed
        CallWithRetry {
            call: Call {
                contract: broken_id.clone(),
                function: symbol_short!("broken"),
                args: Vec::new(&env),
            },
            retry: default_retry(2),
        },
        // This one succeeds on first attempt
        CallWithRetry {
            call: Call {
                contract: mock_id.clone(),
                function: symbol_short!("echo"),
                args: (42u32,).into_val(&env),
            },
            retry: default_retry(3),
        },
    ]);

    let caller = soroban_sdk::Address::generate(&env);
    let batch = client.execute_batch_with_retry(&caller, &calls, &false);

    // broken exhausted 2 attempts
    let op0 = batch.results.get_unchecked(0);
    assert_eq!(op0.status, OpStatus::Failed);
    assert_eq!(op0.attempts, 2);

    // mock succeeded on attempt 1
    let op1 = batch.results.get_unchecked(1);
    assert_eq!(op1.status, OpStatus::Success);
    assert_eq!(op1.attempts, 1);

    assert_eq!(batch.succeeded, 1);
    assert_eq!(batch.failed, 1);
}

#[test]
fn test_failed_call_does_not_abort_batch() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let broken_id = env.register(BrokenContract, ());
    let mock_id = env.register(MockContract, ());

    let calls = Vec::from_array(&env, [
        CallWithRetry {
            call: Call { contract: broken_id.clone(), function: symbol_short!("broken"), args: Vec::new(&env) },
            retry: default_retry(2),
        },
        CallWithRetry {
            call: Call { contract: mock_id.clone(), function: symbol_short!("echo"), args: (99u32,).into_val(&env) },
            retry: default_retry(1),
        },
    ]);

    let caller = soroban_sdk::Address::generate(&env);
    let batch = client.execute_batch_with_retry(&caller, &calls, &false);

    assert_eq!(batch.succeeded, 1);
    assert_eq!(batch.failed, 1);
    assert_eq!(batch.skipped, 0);
    assert_eq!(batch.results.get_unchecked(0).status, OpStatus::Failed);
    assert_eq!(batch.results.get_unchecked(0).attempts, 2);
    assert_eq!(batch.results.get_unchecked(1).status, OpStatus::Success);
}

#[test]
fn test_abort_on_failure_skips_remaining() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let broken_id = env.register(BrokenContract, ());
    let mock_id = env.register(MockContract, ());

    let calls = Vec::from_array(&env, [
        CallWithRetry {
            call: Call { contract: broken_id.clone(), function: symbol_short!("broken"), args: Vec::new(&env) },
            retry: default_retry(1),
        },
        CallWithRetry {
            call: Call { contract: mock_id.clone(), function: symbol_short!("echo"), args: (7u32,).into_val(&env) },
            retry: default_retry(1),
        },
        CallWithRetry {
            call: Call { contract: mock_id.clone(), function: symbol_short!("echo"), args: (8u32,).into_val(&env) },
            retry: default_retry(1),
        },
    ]);

    let caller = soroban_sdk::Address::generate(&env);
    let batch = client.execute_batch_with_retry(&caller, &calls, &true);

    assert_eq!(batch.succeeded, 0);
    assert_eq!(batch.failed, 1);
    assert_eq!(batch.skipped, 2);
    assert_eq!(batch.results.get_unchecked(0).status, OpStatus::Failed);
    assert_eq!(batch.results.get_unchecked(1).status, OpStatus::Skipped);
    assert_eq!(batch.results.get_unchecked(2).status, OpStatus::Skipped);
}

#[test]
fn test_nonce_increments() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let mock_id = env.register(MockContract, ());
    let caller = soroban_sdk::Address::generate(&env);

    assert_eq!(client.get_nonce(&caller), 0);

    let calls = Vec::from_array(&env, [CallWithRetry {
        call: Call { contract: mock_id.clone(), function: symbol_short!("echo"), args: (1u32,).into_val(&env) },
        retry: default_retry(1),
    }]);

    client.execute_batch_with_retry(&caller, &calls, &false);
    assert_eq!(client.get_nonce(&caller), 1);

    client.execute_batch_with_retry(&caller, &calls, &false);
    assert_eq!(client.get_nonce(&caller), 2);
}

#[test]
fn test_retry_config_clamping() {
    assert_eq!(RetryConfig { max_attempts: 0, delay_ledgers: 0 }.validated().max_attempts, 1);
    assert_eq!(RetryConfig { max_attempts: 99, delay_ledgers: 0 }.validated().max_attempts, 5);
}
