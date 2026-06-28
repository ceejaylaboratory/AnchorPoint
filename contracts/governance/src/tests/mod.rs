//! FUZZ APPROACH: Option A — proptest
//! Rationale: This module wires together our test helpers, defining a reliable baseline environment for our state machine and property fuzzers to execute against.

#![cfg(test)]

pub mod state_machine_tests;
pub mod fuzz_tests;
pub mod storage_verification;

use soroban_sdk::{testutils::Address as _, Address, Env};
use crate::{GovernanceContract, GovernanceContractClient};
use std::cell::RefCell;
use std::thread_local;

thread_local! {
    pub static DYNAMIC_CONTRACT_ID: RefCell<Option<Address>> = RefCell::new(None);
}

pub fn get_dynamic_contract_id() -> Address {
    DYNAMIC_CONTRACT_ID.with(|id| {
        id.borrow().clone().expect("Contract not registered in test env")
    })
}

/// Returns a pre-initialised environment with 5 voter addresses funded and registered.
pub fn setup_governance_env() -> (Env, GovernanceContractClient<'static>, std::vec::Vec<Address>) {
    let env = Env::default();
    
    // Register the contract natively
    let contract_id = env.register(GovernanceContract, ());
    DYNAMIC_CONTRACT_ID.with(|id| {
        *id.borrow_mut() = Some(contract_id.clone());
    });
    let client = GovernanceContractClient::new(&env, &contract_id);
    
    // Initialize the governance contract parameters (Quorum: 200, Voting Duration: 100 ledgers)
    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100);
    
    let mut voters = std::vec::Vec::new();
    for _ in 0..5 {
        voters.push(Address::generate(&env));
    }
    
    (env, client, voters)
}
