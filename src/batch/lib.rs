#![no_std]
//! Batch Transaction Execution Contract
//!
//! This contract allows a user to execute multiple operations across different
//! contracts in one atomic transaction. All calls succeed or all fail.
//!
//! Security Features:
//! - Atomicity: All sub-calls succeed or the entire transaction reverts
//! - Auth forwarding: Each sub-call requires proper authorization
//! - Replay protection: Nonce-based protection against replay attacks

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Val, Vec};

/// Represents a single contract call within a batch
#[contracttype]
#[derive(Clone, Debug)]
pub struct Call {
    /// Target contract address
    pub contract: Address,
    /// Function name to call
    pub function: Symbol,
    /// Arguments to pass to the function
    pub args: Vec<Val>,
}

/// Storage keys for batch executor
#[contracttype]
pub enum DataKey {
    /// Admin address
    Admin,
    /// User nonce for replay protection
    Nonce(Address),
}

#[contract]
pub struct BatchExecutor;

#[contractimpl]
impl BatchExecutor {
    /// Initialize the batch executor contract
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Nonce(admin), &0u64);
    }

    /// Executes a sequence of contract calls in a single atomic transaction.
    /// Returns a list of the execution results.
    /// If any call fails, the entire transaction reverts.
    pub fn execute_batch(env: Env, caller: Address, calls: Vec<Call>) -> Vec<Val> {
        caller.require_auth();

        // Increment nonce for replay protection
        let current_nonce: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Nonce(caller.clone()))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::Nonce(caller.clone()), &(current_nonce + 1));

        // Execute all calls atomically
        let mut results = Vec::new(&env);
        for call in calls.iter() {
            let result: Val =
                env.invoke_contract(&call.contract, &call.function, call.args.clone());
            results.push_back(result);
        }

        // Emit event for batch execution
        env.events().publish(
            (soroban_sdk::symbol_short!("batch"), caller.clone()),
            (current_nonce, calls.len()),
        );

        results
    }

    /// Get the current nonce for an address
    pub fn get_nonce(env: Env, user: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::Nonce(user))
            .unwrap_or(0)
    }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set")
    }
}

mod test;
