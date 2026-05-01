#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Val, Vec};

#[contracttype]
pub enum DataKey {
    Admin,
    Implementation,
}

#[contract]
pub struct ProxyContract;

#[contractimpl]
impl ProxyContract {
    pub fn initialize(env: Env, admin: Address, implementation: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Implementation, &implementation);
    }

    pub fn upgrade(env: Env, new_implementation: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Implementation, &new_implementation);
    }

    // Fallback/forwarding function
    pub fn forward(env: Env, function_name: Symbol, args: Vec<Val>) -> Val {
        let implementation: Address = env
            .storage()
            .instance()
            .get(&DataKey::Implementation)
            .unwrap();

        env.invoke_contract(&implementation, &function_name, args)
    }
}
