#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Val, Vec};

#[contracttype]
#[derive(Clone, Debug)]
pub struct Call {
    pub contract: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
}

#[contract]
pub struct BatchExecutor;

#[contractimpl]
impl BatchExecutor {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    /// Executes a sequence of contract calls in a single transaction.
    /// Returns a list of the execution results.
    /// If any call fails, the entire transaction reverts.
    pub fn execute_batch(env: Env, calls: Vec<Call>) -> Vec<Val> {
        let mut results = Vec::new(&env);
        for call in calls.iter() {
            let result: Val = env.invoke_contract(&call.contract, &call.function, call.args.clone());
            results.push_back(result);
        }
        results
    }
}

mod test;
