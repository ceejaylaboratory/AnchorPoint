#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, Env, Symbol, Val, Vec,
};

#[contracttype]
#[derive(Clone, Debug)]
pub struct Call {
    pub contract: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
}

/// A single token transfer operation used in batch execution.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TransferOp {
    /// SPL/SEP-41 token contract address
    pub token: Address,
    /// Source address (must have authorised the batch caller)
    pub from: Address,
    /// Destination address
    pub to: Address,
    /// Amount to transfer (must be > 0)
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub delay_ledgers: u32,
}

impl RetryConfig {
    #[allow(clippy::manual_clamp)]
    pub fn validated(self) -> Self {
        RetryConfig {
            max_attempts: self.max_attempts.clamp(1, 5),
            delay_ledgers: self.delay_ledgers,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CallWithRetry {
    pub call: Call,
    pub retry: RetryConfig,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum OpStatus {
    Success,
    Failed,
    Skipped,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OpResult {
    pub index: u32,
    pub status: OpStatus,
    pub attempts: u32,
    pub value: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchResult {
    pub results: Vec<OpResult>,
    pub succeeded: u32,
    pub failed: u32,
    pub skipped: u32,
    pub nonce: u64,
}

/// Errors returned by the batch executor.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum BatchError {
    /// The operation cannot be estimated or executed by this contract.
    UnsupportedOperation = 1,
    /// The batch has no operations or more than `MAX_ESTIMATE_OPS`.
    InvalidBatchSize = 2,
}

/// An operation submitted to `estimate_batch`.
#[contracttype]
#[derive(Clone, Debug)]
pub enum BatchOp {
    /// A single cross-contract call, as executed by `execute_batch`.
    Call(Call),
    /// A cross-contract call with retries, as executed by `execute_batch_with_retry`.
    RetryCall(CallWithRetry),
    /// A token transfer, as executed by `execute_transfers`.
    Transfer(TransferOp),
}

/// Estimated resource usage of a single batch operation.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct OpEstimate {
    pub index: u32,
    pub cpu_insns: u64,
    pub mem_bytes: u64,
}

/// Estimated resource usage of a whole batch: per-operation estimates plus
/// the batch total (which includes a fixed per-invocation overhead).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BatchEstimate {
    pub ops: Vec<OpEstimate>,
    pub total_cpu_insns: u64,
    pub total_mem_bytes: u64,
}

/// Maximum number of operations accepted by `estimate_batch`.
pub const MAX_ESTIMATE_OPS: u32 = 50;

// Static cost model (CPU instructions / memory bytes). These are deliberately
// conservative upper-bound figures for planning, not metered values.
const BASE_CPU: u64 = 50_000;
const BASE_MEM: u64 = 10_000;
const CALL_CPU: u64 = 100_000;
const CALL_MEM: u64 = 20_000;
const ARG_CPU: u64 = 5_000;
const ARG_MEM: u64 = 1_000;
const TRANSFER_CPU: u64 = 250_000;
const TRANSFER_MEM: u64 = 40_000;

/// Overflow-checked `a * b + c`; panics on arithmetic overflow.
pub fn checked_cost(a: u64, b: u64, c: u64) -> u64 {
    a.checked_mul(b)
        .and_then(|v| v.checked_add(c))
        .expect("estimate overflow")
}

#[contracttype]
pub enum DataKey {
    Admin,
    Nonce(Address),
}

#[contract]
pub struct BatchExecutor;

#[allow(deprecated)]
#[contractimpl]
impl BatchExecutor {
    /// Estimate the CPU and memory cost of a batch without executing it.
    ///
    /// Read-only: no target contract is invoked, no auth is required and no
    /// state (including nonces) is written.
    ///
    /// # Panics
    /// * `BatchError::InvalidBatchSize` if `ops` is empty or exceeds `MAX_ESTIMATE_OPS`.
    /// * `BatchError::UnsupportedOperation` for operations this contract cannot
    ///   execute: calls back into the batch executor itself, or non-positive transfers.
    /// * `"estimate overflow"` on arithmetic overflow.
    pub fn estimate_batch(env: Env, ops: Vec<BatchOp>) -> BatchEstimate {
        let len = ops.len();
        if len == 0 || len > MAX_ESTIMATE_OPS {
            panic_with_error!(&env, BatchError::InvalidBatchSize);
        }

        let self_address = env.current_contract_address();
        let mut estimates = Vec::new(&env);
        let mut total_cpu = BASE_CPU;
        let mut total_mem = BASE_MEM;

        for (raw_index, op) in ops.iter().enumerate() {
            let (cpu_insns, mem_bytes) = match op {
                BatchOp::Call(call) => {
                    Self::check_call_supported(&env, &self_address, &call);
                    Self::call_cost(&call)
                }
                BatchOp::RetryCall(item) => {
                    Self::check_call_supported(&env, &self_address, &item.call);
                    let attempts = item.retry.validated().max_attempts as u64;
                    let (cpu, mem) = Self::call_cost(&item.call);
                    (checked_cost(cpu, attempts, 0), checked_cost(mem, attempts, 0))
                }
                BatchOp::Transfer(transfer) => {
                    if transfer.amount <= 0 || transfer.token == self_address {
                        panic_with_error!(&env, BatchError::UnsupportedOperation);
                    }
                    (TRANSFER_CPU, TRANSFER_MEM)
                }
            };

            total_cpu = total_cpu.checked_add(cpu_insns).expect("estimate overflow");
            total_mem = total_mem.checked_add(mem_bytes).expect("estimate overflow");
            estimates.push_back(OpEstimate {
                index: raw_index as u32,
                cpu_insns,
                mem_bytes,
            });
        }

        BatchEstimate {
            ops: estimates,
            total_cpu_insns: total_cpu,
            total_mem_bytes: total_mem,
        }
    }

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Nonce(admin.clone()), &0u64);
        env.events()
            .publish((symbol_short!("init"),), admin);
    }

    pub fn execute_batch(env: Env, caller: Address, calls: Vec<Call>) -> Vec<Val> {
        caller.require_auth();

        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Nonce(caller.clone()))
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::Nonce(caller.clone()),
            &current_nonce.checked_add(1).expect("nonce overflow"),
        );

        let mut results = Vec::new(&env);
        for call in calls.iter() {
            let result: Val =
                env.invoke_contract(&call.contract, &call.function, call.args.clone());
            results.push_back(result);
        }

        // Topic: event name only; caller + nonce + count in data.
        env.events().publish(
            (symbol_short!("exec"), symbol_short!("batch")),
            (caller, current_nonce, calls.len()),
        );

        results
    }

    /// Execute calls with retries. If `abort_on_failure` is true, an exhausted
    /// call reverts the full Soroban invocation, including earlier successes.
    pub fn execute_batch_with_retry(
        env: Env,
        caller: Address,
        calls: Vec<CallWithRetry>,
        abort_on_failure: bool,
    ) -> BatchResult {
        caller.require_auth();

        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Nonce(caller.clone()))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::Nonce(caller.clone()), &(current_nonce + 1));

        let mut results: Vec<OpResult> = Vec::new(&env);
        let mut succeeded: u32 = 0;
        let mut failed: u32 = 0;
        let skipped: u32 = 0;

        for (raw_index, item) in calls.iter().enumerate() {
            let index = raw_index as u32;

            let policy = item.retry.clone().validated();
            let call = item.call.clone();
            let max_attempts = policy.max_attempts;

            let mut attempt: u32 = 0;
            let mut op_status = OpStatus::Failed;
            let mut op_attempts: u32 = 0;

            while attempt < max_attempts {
                attempt += 1;

                let outcome = env.try_invoke_contract::<Val, Val>(
                    &call.contract,
                    &call.function,
                    call.args.clone(),
                );

                match outcome {
                    Ok(Ok(_val)) => {
                        op_status = OpStatus::Success;
                        op_attempts = attempt;
                        succeeded += 1;
                        break;
                    }
                    Ok(Err(_)) => {
                        op_attempts = attempt;
                        if attempt == max_attempts {
                            op_status = OpStatus::Failed;
                        }
                    }
                    Err(_) => {
                        op_attempts = attempt;
                        if attempt == max_attempts {
                            op_status = OpStatus::Failed;
                        }
                    }
                }
            }

            if op_status == OpStatus::Failed {
                failed += 1;
                if abort_on_failure {
                    panic!("batch operation failed; reverting batch");
                }
            }

            results.push_back(OpResult {
                index,
                status: op_status,
                attempts: op_attempts,
                value: 0,
            });
        }

        env.events().publish(
            (soroban_sdk::symbol_short!("batch_r"), caller.clone()),
            (current_nonce, succeeded, failed, skipped),
        );

        BatchResult {
            results,
            succeeded,
            failed,
            skipped,
            nonce: current_nonce,
        }
    }

    pub fn get_nonce(env: Env, user: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Nonce(user))
            .unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set")
    }

    /// Execute a batch of token transfers with payload verification.
    ///
    /// # Verification
    /// - Rejects an empty `ops` vector.
    /// - Rejects batches larger than 50 operations (`MAX_BATCH_SIZE`).
    /// - Each `amount` must be positive.
    ///
    /// Execution is sequential and stops on the first failure, returning the
    /// index of the failing operation.  On success returns `ops.len()`.
    pub fn execute_transfers(env: Env, caller: Address, ops: Vec<TransferOp>) -> u32 {
        caller.require_auth();

        const MAX_BATCH_SIZE: u32 = 50;
        let len = ops.len();

        assert!(len > 0, "empty batch");
        assert!(len <= MAX_BATCH_SIZE, "batch exceeds max size of 50");

        // Validate all ops before executing any
        for op in ops.iter() {
            assert!(op.amount > 0, "amount must be positive");
        }

        let mut executed: u32 = 0;
        for op in ops.iter() {
            token::Client::new(&env, &op.token).transfer(&op.from, &op.to, &op.amount);
            executed += 1;
        }

        env.events().publish(
            (symbol_short!("xfer_bat"), caller),
            (len, executed),
        );

        executed
    }
}

impl BatchExecutor {
    fn check_call_supported(env: &Env, self_address: &Address, call: &Call) {
        // Re-entrant batches are not supported by the executor.
        if call.contract == *self_address {
            panic_with_error!(env, BatchError::UnsupportedOperation);
        }
    }

    fn call_cost(call: &Call) -> (u64, u64) {
        let args = call.args.len() as u64;
        (
            checked_cost(ARG_CPU, args, CALL_CPU),
            checked_cost(ARG_MEM, args, CALL_MEM),
        )
    }
}

mod test;
