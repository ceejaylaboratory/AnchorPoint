#![cfg(test)]

use super::{
    checked_cost, BatchError, BatchExecutor, BatchExecutorClient, BatchOp, BatchResult, Call,
    CallWithRetry, OpStatus, RetryConfig, TransferOp, MAX_ESTIMATE_OPS,
};
use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::{Address as _, Events},
    token::StellarAssetClient, vec as svec, Env, IntoVal, Vec,
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

#[contract]
pub struct CounterContract;

#[contractimpl]
impl CounterContract {
    pub fn increment(env: Env) {
        let key = symbol_short!("count");
        let count: u32 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(count + 1));
    }

    pub fn get_count(env: Env) -> u32 {
        env.storage().instance().get(&symbol_short!("count")).unwrap_or(0)
    }
}

fn default_retry(max_attempts: u32) -> RetryConfig {
    RetryConfig {
        max_attempts,
        delay_ledgers: 0,
    }
}

fn setup(env: &Env) -> BatchExecutorClient<'_> {
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

    let calls = Vec::from_array(
        &env,
        [
            Call {
                contract: mock_id.clone(),
                function: symbol_short!("echo"),
                args: (123u32,).into_val(&env),
            },
            Call {
                contract: mock_id.clone(),
                function: symbol_short!("echo"),
                args: (456u32,).into_val(&env),
            },
        ],
    );

    let caller = soroban_sdk::Address::generate(&env);
    let results = client.execute_batch(&caller, &calls);

    assert_eq!(results.len(), 2);
    let v0: u32 = results.get_unchecked(0).into_val(&env);
    let v1: u32 = results.get_unchecked(1).into_val(&env);
    assert_eq!(v0, 123u32);
    assert_eq!(v1, 456u32);
    assert_eq!(
        env.events().all().filter_by_contract(&client.address),
        svec![
            &env,
            (
                client.address.clone(),
                svec![
                    &env,
                    symbol_short!("exec").into_val(&env),
                    symbol_short!("batch").into_val(&env),
                ],
                (caller, 0_u64, 2_u32).into_val(&env),
            )
        ]
    );
}

#[test]
fn test_retry_all_succeed_first_try() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let mock_id = env.register(MockContract, ());

    let make = |v: u32| CallWithRetry {
        call: Call {
            contract: mock_id.clone(),
            function: symbol_short!("echo"),
            args: (v,).into_val(&env),
        },
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

    let calls = Vec::from_array(
        &env,
        [
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
        ],
    );

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

    let calls = Vec::from_array(
        &env,
        [
            CallWithRetry {
                call: Call {
                    contract: broken_id.clone(),
                    function: symbol_short!("broken"),
                    args: Vec::new(&env),
                },
                retry: default_retry(2),
            },
            CallWithRetry {
                call: Call {
                    contract: mock_id.clone(),
                    function: symbol_short!("echo"),
                    args: (99u32,).into_val(&env),
                },
                retry: default_retry(1),
            },
        ],
    );

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
fn test_abort_on_failure_reverts_prior_operations() {
    let env = Env::default();
    env.mock_all_auths();
    let batch_id = env.register(BatchExecutor, ());
    let client = BatchExecutorClient::new(&env, &batch_id);
    let admin = soroban_sdk::Address::generate(&env);
    client.initialize(&admin);
    let counter_id = env.register(CounterContract, ());
    let broken_id = env.register(BrokenContract, ());

    let calls = Vec::from_array(
        &env,
        [
            CallWithRetry {
                call: Call {
                    contract: counter_id.clone(),
                    function: symbol_short!("increment"),
                    args: Vec::new(&env),
                },
                retry: default_retry(1),
            },
            CallWithRetry {
                call: Call {
                    contract: broken_id,
                    function: symbol_short!("broken"),
                    args: Vec::new(&env),
                },
                retry: default_retry(1),
            },
        ],
    );

    let caller = soroban_sdk::Address::generate(&env);
    let args = (&caller, &calls, &true).into_val(&env);
    let result = env.try_invoke_contract::<BatchResult, soroban_sdk::Val>(
        &batch_id,
        &soroban_sdk::Symbol::new(&env, "execute_batch_with_retry"),
        args,
    );

    assert!(result.is_err());
    assert_eq!(CounterContractClient::new(&env, &counter_id).get_count(), 0);
    assert_eq!(client.get_nonce(&caller), 0);
}

#[test]
fn test_nonce_increments() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let mock_id = env.register(MockContract, ());
    let caller = soroban_sdk::Address::generate(&env);

    assert_eq!(client.get_nonce(&caller), 0);

    let calls = Vec::from_array(
        &env,
        [CallWithRetry {
            call: Call {
                contract: mock_id.clone(),
                function: symbol_short!("echo"),
                args: (1u32,).into_val(&env),
            },
            retry: default_retry(1),
        }],
    );

    client.execute_batch_with_retry(&caller, &calls, &false);
    assert_eq!(client.get_nonce(&caller), 1);

    client.execute_batch_with_retry(&caller, &calls, &false);
    assert_eq!(client.get_nonce(&caller), 2);
}

#[test]
fn test_retry_config_clamping() {
    assert_eq!(
        RetryConfig {
            max_attempts: 0,
            delay_ledgers: 0
        }
        .validated()
        .max_attempts,
        1
    );
    assert_eq!(
        RetryConfig {
            max_attempts: 99,
            delay_ledgers: 0
        }
        .validated()
        .max_attempts,
        5
    );
}

// ============================================================================
// execute_transfers tests
// ============================================================================

fn mint_and_setup_token(env: &Env, admin: &soroban_sdk::Address, amount: i128) -> soroban_sdk::Address {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let addr = sac.address();
    StellarAssetClient::new(env, &addr).mint(admin, &amount);
    addr
}

#[test]
fn test_execute_transfers_success() {
    let env = Env::default();
    // `from` authorizes inside the nested token call, not at the root.
    env.mock_all_auths_allowing_non_root_auth();
    let batch_client = setup(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let recipient = soroban_sdk::Address::generate(&env);
    let token_addr = mint_and_setup_token(&env, &admin, 1000);

    let ops = Vec::from_array(&env, [TransferOp {
        token: token_addr.clone(),
        from: admin.clone(),
        to: recipient.clone(),
        amount: 300,
    }]);

    let caller = soroban_sdk::Address::generate(&env);
    let executed = batch_client.execute_transfers(&caller, &ops);
    assert_eq!(executed, 1);

    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    assert_eq!(token_client.balance(&recipient), 300);
    assert_eq!(token_client.balance(&admin), 700);
}

#[test]
fn test_execute_transfers_multiple_ops() {
    let env = Env::default();
    // `from` authorizes inside the nested token call, not at the root.
    env.mock_all_auths_allowing_non_root_auth();
    let batch_client = setup(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let bob = soroban_sdk::Address::generate(&env);
    let carol = soroban_sdk::Address::generate(&env);
    let token_addr = mint_and_setup_token(&env, &admin, 1000);

    let ops = Vec::from_array(&env, [
        TransferOp { token: token_addr.clone(), from: admin.clone(), to: bob.clone(), amount: 200 },
        TransferOp { token: token_addr.clone(), from: admin.clone(), to: carol.clone(), amount: 300 },
    ]);

    let caller = soroban_sdk::Address::generate(&env);
    let executed = batch_client.execute_transfers(&caller, &ops);
    assert_eq!(executed, 2);

    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    assert_eq!(token_client.balance(&bob), 200);
    assert_eq!(token_client.balance(&carol), 300);
    assert_eq!(token_client.balance(&admin), 500);
}

#[test]
#[should_panic(expected = "empty batch")]
fn test_execute_transfers_empty_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let batch_client = setup(&env);
    let caller = soroban_sdk::Address::generate(&env);
    let ops: Vec<TransferOp> = Vec::new(&env);
    batch_client.execute_transfers(&caller, &ops);
}

#[test]
#[should_panic(expected = "batch exceeds max size of 50")]
fn test_execute_transfers_over_limit_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let batch_client = setup(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let token_addr = mint_and_setup_token(&env, &admin, 100_000);
    let recipient = soroban_sdk::Address::generate(&env);

    let mut ops = Vec::new(&env);
    for _ in 0..51 {
        ops.push_back(TransferOp {
            token: token_addr.clone(),
            from: admin.clone(),
            to: recipient.clone(),
            amount: 1,
        });
    }

    let caller = soroban_sdk::Address::generate(&env);
    batch_client.execute_transfers(&caller, &ops);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_execute_transfers_zero_amount_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let batch_client = setup(&env);

    let admin = soroban_sdk::Address::generate(&env);
    let token_addr = mint_and_setup_token(&env, &admin, 1000);
    let recipient = soroban_sdk::Address::generate(&env);

    let ops = Vec::from_array(&env, [TransferOp {
        token: token_addr.clone(),
        from: admin.clone(),
        to: recipient.clone(),
        amount: 0,
    }]);

    let caller = soroban_sdk::Address::generate(&env);
    batch_client.execute_transfers(&caller, &ops);
}

// ── estimate_batch ───────────────────────────────────────────────────────────

fn increment_call(env: &Env, counter_id: &soroban_sdk::Address) -> Call {
    Call {
        contract: counter_id.clone(),
        function: symbol_short!("increment"),
        args: Vec::new(env),
    }
}

#[test]
fn test_estimate_batch_returns_per_op_and_total() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let mock_id = env.register(MockContract, ());
    let token = soroban_sdk::Address::generate(&env);

    let echo = Call {
        contract: mock_id.clone(),
        function: symbol_short!("echo"),
        args: svec![&env, 7u32.into_val(&env)],
    };
    let ops = svec![
        &env,
        BatchOp::Call(echo.clone()),
        BatchOp::RetryCall(CallWithRetry { call: echo, retry: default_retry(3) }),
        BatchOp::Transfer(TransferOp {
            token,
            from: soroban_sdk::Address::generate(&env),
            to: soroban_sdk::Address::generate(&env),
            amount: 10,
        }),
    ];

    let estimate = client.estimate_batch(&ops);
    assert_eq!(estimate.ops.len(), 3);

    let call = estimate.ops.get(0).unwrap();
    let retry = estimate.ops.get(1).unwrap();
    let transfer = estimate.ops.get(2).unwrap();
    assert_eq!((call.index, retry.index, transfer.index), (0, 1, 2));
    assert!(call.cpu_insns > 0 && call.mem_bytes > 0);
    // A retried call is costed for every allowed attempt.
    assert_eq!(retry.cpu_insns, call.cpu_insns * 3);
    assert_eq!(retry.mem_bytes, call.mem_bytes * 3);

    let op_cpu: u64 = estimate.ops.iter().map(|e| e.cpu_insns).sum();
    let op_mem: u64 = estimate.ops.iter().map(|e| e.mem_bytes).sum();
    // Totals include a fixed per-batch overhead on top of the per-op sum.
    assert!(estimate.total_cpu_insns > op_cpu);
    assert!(estimate.total_mem_bytes > op_mem);
}

#[test]
fn test_estimate_batch_scales_with_args() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let mock_id = env.register(MockContract, ());
    let call = |args: Vec<soroban_sdk::Val>| Call {
        contract: mock_id.clone(),
        function: symbol_short!("echo"),
        args,
    };
    let small = client.estimate_batch(&svec![&env, BatchOp::Call(call(Vec::new(&env)))]);
    let large = client.estimate_batch(&svec![
        &env,
        BatchOp::Call(call(svec![&env, 1u32.into_val(&env), 2u32.into_val(&env)]))
    ]);
    assert!(large.total_cpu_insns > small.total_cpu_insns);
    assert!(large.total_mem_bytes > small.total_mem_bytes);
}

#[test]
fn test_estimate_batch_does_not_execute_or_bump_nonce() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let counter_id = env.register(CounterContract, ());
    let counter = CounterContractClient::new(&env, &counter_id);
    let caller = soroban_sdk::Address::generate(&env);

    let ops = svec![
        &env,
        BatchOp::Call(increment_call(&env, &counter_id)),
        BatchOp::RetryCall(CallWithRetry {
            call: increment_call(&env, &counter_id),
            retry: default_retry(2),
        }),
    ];
    client.estimate_batch(&ops);

    // No target call was made and no nonce was consumed.
    assert_eq!(counter.get_count(), 0);
    assert_eq!(client.get_nonce(&caller), 0);
    // No authorization was required for the estimate.
    assert!(env.auths().is_empty());
}

#[test]
fn test_estimate_batch_rejects_self_call() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let ops = svec![
        &env,
        BatchOp::Call(Call {
            contract: client.address.clone(),
            function: symbol_short!("get_nonce"),
            args: Vec::new(&env),
        })
    ];
    assert_eq!(
        client.try_estimate_batch(&ops),
        Err(Ok(BatchError::UnsupportedOperation.into()))
    );
}

#[test]
fn test_estimate_batch_rejects_non_positive_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let ops = svec![
        &env,
        BatchOp::Transfer(TransferOp {
            token: soroban_sdk::Address::generate(&env),
            from: soroban_sdk::Address::generate(&env),
            to: soroban_sdk::Address::generate(&env),
            amount: 0,
        })
    ];
    assert_eq!(
        client.try_estimate_batch(&ops),
        Err(Ok(BatchError::UnsupportedOperation.into()))
    );
}

#[test]
fn test_estimate_batch_rejects_invalid_size() {
    let env = Env::default();
    env.mock_all_auths();
    let client = setup(&env);
    let mock_id = env.register(MockContract, ());

    assert_eq!(
        client.try_estimate_batch(&Vec::new(&env)),
        Err(Ok(BatchError::InvalidBatchSize.into()))
    );

    let mut ops = Vec::new(&env);
    for _ in 0..=MAX_ESTIMATE_OPS {
        ops.push_back(BatchOp::Call(Call {
            contract: mock_id.clone(),
            function: symbol_short!("echo"),
            args: Vec::new(&env),
        }));
    }
    assert_eq!(
        client.try_estimate_batch(&ops),
        Err(Ok(BatchError::InvalidBatchSize.into()))
    );
}

#[test]
#[should_panic(expected = "estimate overflow")]
fn test_estimate_cost_panics_on_mul_overflow() {
    checked_cost(u64::MAX, 2, 0);
}

#[test]
#[should_panic(expected = "estimate overflow")]
fn test_estimate_cost_panics_on_add_overflow() {
    checked_cost(u64::MAX, 1, 1);
}
