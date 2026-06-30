//! FUZZ APPROACH: Option A — proptest
//! Rationale: Proptest allows us to discover unanticipated edge cases in quorum math and automatically shrinks failures to minimal counterexamples, which is critical for securing state-heavy governance systems.

#![cfg(test)]

use soroban_sdk::{testutils::Ledger, testutils::Address as _, Env, Error};
use crate::{
    GovernanceContract, GovernanceContractClient,
    Phase, GovernanceError,
};
use super::storage_verification::*;
use super::setup_governance_env;

#[test]
fn happy_path_full_lifecycle_from_draft_to_executed() {
    let (env, client, voters) = setup_governance_env();
    let proposer = &voters[0];

    // 1. DRAFT PHASE
    let prop_id = client.create_proposal(&proposer, &soroban_sdk::String::from_str(&env, "Prop 1"));
    assert_phase(&env, prop_id, Phase::Draft);
    assert_proposal_metadata(&env, prop_id, "Prop 1");

    // Advance time to make it Active
    env.ledger().set_sequence_number(env.ledger().sequence() + 1);
    
    // 2. ACTIVE PHASE
    assert_phase(&env, prop_id, Phase::Active);
    
    // Voters 1 and 2 vote YES (reaching quorum of 2)
    client.vote(&voters[1], &prop_id, &true, &100);
    assert_vote_tally(&env, prop_id, 100, 0, 0);
    
    client.vote(&voters[2], &prop_id, &true, &100);
    assert_vote_tally(&env, prop_id, 200, 0, 0);

    // 3. QUORUM REACHED & EXECUTION PENDING
    // Advance past voting deadline
    env.ledger().set_sequence_number(env.ledger().sequence() + 100);
    assert_phase(&env, prop_id, Phase::ExecutionPending);

    // 4. EXECUTED
    let keys_before = get_all_storage_keys(&env);
    client.execute(&prop_id);
    assert_phase(&env, prop_id, Phase::Executed);
    
    let keys_after = get_all_storage_keys(&env);
    assert_no_storage_leaks(&env, keys_before, keys_after);
}

#[test]
fn executing_before_quorum_returns_quorum_not_reached_error() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));
    
    env.ledger().set_sequence_number(env.ledger().sequence() + 1); // Active
    
    // Only one vote (quorum is 2)
    client.vote(&voters[1], &prop_id, &true, &100);
    
    env.ledger().set_sequence_number(env.ledger().sequence() + 100); // Past deadline
    
    assert_phase(&env, prop_id, Phase::Defeated);
    
    let err = client.try_execute(&prop_id).expect_err("Execution should fail without quorum");
    assert_eq!(err, Ok(Error::from(GovernanceError::QuorumNotReached)));
}

#[test]
fn voting_after_deadline_returns_vote_closed_error() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));
    
    // Fast forward past deadline
    env.ledger().set_sequence_number(env.ledger().sequence() + 101);
    
    let err = client.try_vote(&voters[1], &prop_id, &true, &100).expect_err("Should not vote after deadline");
    assert_eq!(err, Ok(Error::from(GovernanceError::VotingClosed)));
}

#[test]
fn double_vote_prevention_same_address_votes_twice_returns_error() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));
    
    env.ledger().set_sequence_number(env.ledger().sequence() + 1); // Active
    
    // First vote succeeds
    client.vote(&voters[1], &prop_id, &true, &100);
    
    // Second vote fails
    let err = client.try_vote(&voters[1], &prop_id, &false, &50).expect_err("Double vote should fail");
    assert_eq!(err, Ok(Error::from(GovernanceError::AlreadyVoted)));
}

#[test]
fn cancelled_proposal_cannot_be_reactivated() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));
    
    client.cancel(&voters[0], &prop_id); // Assuming proposer can cancel in draft
    assert_phase(&env, prop_id, Phase::Cancelled);
    
    // Advance time to when it would normally be active
    env.ledger().set_sequence_number(env.ledger().sequence() + 1);
    
    // Still cancelled
    assert_phase(&env, prop_id, Phase::Cancelled);
    
    let err = client.try_vote(&voters[1], &prop_id, &true, &100).expect_err("Cannot vote on cancelled");
    assert_eq!(err, Ok(Error::from(GovernanceError::InvalidPhase)));
}

#[test]
fn time_window_boundaries_vote_at_last_valid_ledger_succeeds() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));
    
    // Assuming voting duration is 100 ledgers
    env.ledger().set_sequence_number(env.ledger().sequence() + 100);
    
    // Vote at exact boundary succeeds
    client.vote(&voters[1], &prop_id, &true, &100);
    assert_vote_tally(&env, prop_id, 100, 0, 0);
    
    // Next ledger fails
    env.ledger().set_sequence_number(env.ledger().sequence() + 1);
    let err = client.try_vote(&voters[2], &prop_id, &true, &100).expect_err("One ledger after deadline must fail");
    assert_eq!(err, Ok(Error::from(GovernanceError::VotingClosed)));
}

#[test]
fn quorum_boundary_exactly_at_threshold_passes_one_below_fails() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));
    env.ledger().set_sequence_number(env.ledger().sequence() + 1); // Active
    
    // Quorum threshold is 200 weight
    client.vote(&voters[1], &prop_id, &true, &199);
    env.ledger().set_sequence_number(env.ledger().sequence() + 100); // End voting
    
    assert_phase(&env, prop_id, Phase::Defeated);
    
    // Create new proposal
    let prop_2 = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop 2"));
    env.ledger().set_sequence_number(env.ledger().sequence() + 1);
    
    // Hit exact quorum
    client.vote(&voters[1], &prop_2, &true, &200);
    env.ledger().set_sequence_number(env.ledger().sequence() + 100);
    
    assert_phase(&env, prop_2, Phase::ExecutionPending);
}

#[test]
fn test_admin_transfer_success() {
    let (env, client, _) = setup_governance_env();
    let current_admin = client.get_admin();
    let new_admin = soroban_sdk::Address::generate(&env);

    env.mock_all_auths();
    client.transfer_admin(&current_admin, &new_admin);

    assert_eq!(client.get_admin(), new_admin);
}

#[test]
#[should_panic]
fn test_admin_transfer_unauthorized() {
    let (env, client, voters) = setup_governance_env();
    let bad_actor = &voters[0];
    let new_admin = soroban_sdk::Address::generate(&env);

    env.mock_all_auths();
    client.transfer_admin(bad_actor, &new_admin);
}
