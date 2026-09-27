#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Symbol, Val, Vec,
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
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Nonce(admin), &0u64);
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

mod test;
