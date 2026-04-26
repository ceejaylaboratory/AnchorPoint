#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Symbol, Vec, Val};

#[contracttype]
pub enum DataKey {
    Admin,
    Implementation,
}

#[contract]
pub struct ProxyContract;

#[contractimpl]
impl ProxyContract {
    pub fn initialize(env: Env, admin: Address, implementation: BytesN<32>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Implementation, &implementation);
    }

    pub fn upgrade(env: Env, new_implementation: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Implementation, &new_implementation);
    }

    // Fallback/forwarding function
    pub fn forward(env: Env, function_name: Symbol, args: Vec<Val>) -> Val {
        let implementation: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::Implementation)
            .unwrap();
        
        env.invoke_contract(&implementation.into(), &function_name, args)
    }
}
