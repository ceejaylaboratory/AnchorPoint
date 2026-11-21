//! FUZZ APPROACH: Option A — proptest
//! Rationale: This module wires together our test helpers, defining a reliable baseline environment for our state machine and property fuzzers to execute against.

#![cfg(test)]
#![allow(clippy::missing_const_for_thread_local)]

pub mod fuzz_tests;
pub mod state_machine_tests;
pub mod storage_verification;

use crate::{GovernanceContract, GovernanceContractClient, MIN_TIMELOCK_DELAY};
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env};
use std::cell::RefCell;
use std::thread_local;

thread_local! {
    pub static DYNAMIC_CONTRACT_ID: RefCell<Option<Address>> = RefCell::new(None);
}

pub fn get_dynamic_contract_id() -> Address {
    DYNAMIC_CONTRACT_ID.with(|id| {
        id.borrow()
            .clone()
            .expect("Contract not registered in test env")
    })
}

/// Returns a pre-initialised environment with 5 voter addresses funded and registered.
pub fn setup_governance_env() -> (
    Env,
    GovernanceContractClient<'static>,
    std::vec::Vec<Address>,
) {
    let env = Env::default();
    env.mock_all_auths();

    // Register the contract natively
    let contract_id = env.register(GovernanceContract, ());
    DYNAMIC_CONTRACT_ID.with(|id| {
        *id.borrow_mut() = Some(contract_id.clone());
    });
    let client = GovernanceContractClient::new(&env, &contract_id);

    // Initialize the governance contract parameters (Quorum: 200, Voting Duration: 100 ledgers, Timelock Delay: 34,560 ledgers)
    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    let mut voters = std::vec::Vec::new();
    for _ in 0..5 {
        voters.push(Address::generate(&env));
    }

    (env, client, voters)
}

#[test]
fn test_initialization() {
    let env = Env::default();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_timelock_delay(), MIN_TIMELOCK_DELAY);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);
}

#[test]
fn test_initialize_below_minimum_timelock_delay_fails() {
    let env = Env::default();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let err = client
        .try_initialize(&admin, &200, &100, &(MIN_TIMELOCK_DELAY - 1))
        .expect_err("Should reject initialization below minimum timelock delay");
    assert_eq!(err, Ok(crate::GovernanceError::InvalidTimelockDelay));
}

#[test]
fn test_update_timelock_delay_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    let new_delay = MIN_TIMELOCK_DELAY + 1000;
    client.set_timelock_delay(&admin, &new_delay);
    assert_eq!(client.get_timelock_delay(), new_delay);
}

#[test]
fn test_update_timelock_delay_below_minimum_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    let err = client
        .try_set_timelock_delay(&admin, &(MIN_TIMELOCK_DELAY - 1))
        .expect_err("Should reject setting timelock delay below minimum");
    assert_eq!(err, Ok(crate::GovernanceError::InvalidTimelockDelay));
}

#[test]
#[should_panic(expected = "unauthorized")]
fn test_update_timelock_delay_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let bad_actor = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    client.set_timelock_delay(&bad_actor, &(MIN_TIMELOCK_DELAY + 100));
}

#[test]
fn test_multisig_council_setup() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);

    let mut council = soroban_sdk::Vec::new(&env);
    council.push_back(signer1.clone());
    council.push_back(signer2.clone());
    council.push_back(signer3.clone());

    client.set_council(&admin, &council, &2);

    assert_eq!(client.get_threshold(), 2);
    assert_eq!(client.get_council_signers().len(), 3);
}

fn setup_passed_and_queued_proposal(
    env: &Env,
    client: &GovernanceContractClient,
    admin: &Address,
) -> u32 {
    let prop_id = client.create_proposal(admin, &soroban_sdk::String::from_str(env, "Upgrade"));

    // Advance to active phase
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1);

    // Vote to satisfy quorum (quorum threshold is 200)
    client.vote(admin, &prop_id, &true, &200);

    // Advance past voting deadline (+100 ledgers)
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100);

    // Queue proposal
    client.queue(&prop_id);

    // Advance past timelock delay
    let prop = client.get_proposal(&prop_id).unwrap();
    env.ledger()
        .set_sequence_number(prop.executable_after_ledger);

    prop_id
}

#[test]
fn test_execute_proposal_multisig_threshold_success() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);

    let mut council = soroban_sdk::Vec::new(&env);
    council.push_back(signer1.clone());
    council.push_back(signer2.clone());
    council.push_back(signer3.clone());

    // 2-of-3 multisig threshold
    client.set_council(&admin, &council, &2);

    let prop_id = setup_passed_and_queued_proposal(&env, &client, &admin);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(signer1);
    signers.push_back(signer2);

    let res = client.try_execute_proposal(&prop_id, &signers);
    assert!(res.is_ok());
}

#[test]
fn test_execute_proposal_insufficient_signatures_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut council = soroban_sdk::Vec::new(&env);
    council.push_back(signer1.clone());
    council.push_back(signer2.clone());

    client.set_council(&admin, &council, &2);

    let prop_id = setup_passed_and_queued_proposal(&env, &client, &admin);

    // Provide only 1 signature when threshold is 2
    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(signer1);

    let err = client
        .try_execute_proposal(&prop_id, &signers)
        .expect_err("Should fail with insufficient signatures");
    assert_eq!(err, Ok(crate::GovernanceError::InsufficientSignatures));
}

#[test]
fn test_execute_proposal_unauthorized_signer_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let outsider = Address::generate(&env);

    let mut council = soroban_sdk::Vec::new(&env);
    council.push_back(signer1.clone());
    council.push_back(signer2.clone());

    client.set_council(&admin, &council, &2);

    let prop_id = setup_passed_and_queued_proposal(&env, &client, &admin);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(signer1);
    signers.push_back(outsider);

    let err = client
        .try_execute_proposal(&prop_id, &signers)
        .expect_err("Should fail with unauthorized signer");
    assert_eq!(err, Ok(crate::GovernanceError::UnauthorizedSigner));
}

#[test]
fn test_execute_proposal_duplicate_signer_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &200, &100, &MIN_TIMELOCK_DELAY);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut council = soroban_sdk::Vec::new(&env);
    council.push_back(signer1.clone());
    council.push_back(signer2.clone());

    client.set_council(&admin, &council, &2);

    let prop_id = setup_passed_and_queued_proposal(&env, &client, &admin);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer1);

    let err = client
        .try_execute_proposal(&prop_id, &signers)
        .expect_err("Should fail with duplicate signer");
    assert_eq!(err, Ok(crate::GovernanceError::DuplicateSigner));
}
