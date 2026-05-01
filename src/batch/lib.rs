#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Val, Vec};

#[contracttype]
#[derive(Clone, Debug)]
pub struct Call {
    pub contract: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub delay_ledgers: u32,
}

impl RetryConfig {
    pub fn validated(self) -> Self {
        RetryConfig {
            max_attempts: self.max_attempts.max(1).min(5),
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

#[contractimpl]
impl BatchExecutor {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Nonce(admin), &0u64);
    }

    pub fn execute_batch(env: Env, caller: Address, calls: Vec<Call>) -> Vec<Val> {
        caller.require_auth();

        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Nonce(caller.clone()))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::Nonce(caller.clone()), &(current_nonce + 1));

        let mut results = Vec::new(&env);
        for call in calls.iter() {
            let result: Val =
                env.invoke_contract(&call.contract, &call.function, call.args.clone());
            results.push_back(result);
        }

        // Topic: event name only; caller + nonce + count in data.
        env.events().publish(
            symbol_short!("batch"),
            (caller, current_nonce, calls.len()),
        );

        results
    }

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
        let mut skipped: u32 = 0;
        let mut abort = false;

        for (raw_index, item) in calls.iter().enumerate() {
            let index = raw_index as u32;

            if abort {
                results.push_back(OpResult {
                    index,
                    status: OpStatus::Skipped,
                    attempts: 0,
                    value: 0,
                });
                skipped += 1;
                continue;
            }

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
                    abort = true;
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
}

mod test;
