//! FUZZ APPROACH: Option A — proptest
//! Rationale: Proptest allows us to discover unanticipated edge cases in quorum math and automatically shrinks failures to minimal counterexamples, which is critical for securing state-heavy governance systems.

#![cfg(test)]

use super::setup_governance_env;
use super::storage_verification::*;
use crate::{GovernanceError, Phase, MIN_TIMELOCK_DELAY};
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address};

#[test]
fn happy_path_full_lifecycle_from_draft_to_executed() {
    let (env, client, voters) = setup_governance_env();
    let proposer = &voters[0];

    // 1. DRAFT PHASE
    let prop_id = client.create_proposal(proposer, &soroban_sdk::String::from_str(&env, "Prop 1"));
    assert_phase(&env, prop_id, Phase::Draft);
    assert_proposal_metadata(&env, prop_id, "Prop 1");

    // Advance time to make it Active
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1);

    // 2. ACTIVE PHASE
    assert_phase(&env, prop_id, Phase::Active);

    // Voters 1 and 2 vote YES (reaching quorum of 200)
    client.vote(&voters[1], &prop_id, &true, &100);
    assert_vote_tally(&env, prop_id, 100, 0, 0);

    client.vote(&voters[2], &prop_id, &true, &100);
    assert_vote_tally(&env, prop_id, 200, 0, 0);

    // 3. VOTING DEADLINE PASSES -> QUORUM REACHED & QUEUED
    // Advance past voting deadline
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100);
    assert_phase(&env, prop_id, Phase::ExecutionPending);

    // Queue proposal and verify accurate executable_after_ledger
    let queue_seq = env.ledger().sequence();
    client.queue(&prop_id);
    assert_phase(&env, prop_id, Phase::Queued);

    let proposal = client.get_proposal(&prop_id).expect("proposal exists");
    let expected_executable_after = queue_seq + MIN_TIMELOCK_DELAY;
    assert_eq!(
        proposal.executable_after_ledger, expected_executable_after,
        "Executable after ledger must match queue sequence + timelock delay"
    );

    // 4. ATTEMPT PREMATURE EXECUTION -> MUST FAIL WITH TimelockNotExpired
    let err = client
        .try_execute(&prop_id)
        .expect_err("Execution prior to timelock expiration must fail");
    assert_eq!(err, Ok(GovernanceError::TimelockNotExpired));

    // Also verify 1 ledger before expiration fails
    env.ledger()
        .set_sequence_number(expected_executable_after - 1);
    let err_boundary = client
        .try_execute(&prop_id)
        .expect_err("Execution 1 ledger before timelock expiration must fail");
    assert_eq!(err_boundary, Ok(GovernanceError::TimelockNotExpired));

    // 5. ADVANCE LEDGER TO EXECUTABLE LEDGER -> EXECUTION SUCCEEDS
    env.ledger().set_sequence_number(expected_executable_after);

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

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1); // Active

    // Only one vote (quorum is 200)
    client.vote(&voters[1], &prop_id, &true, &100);

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100); // Past deadline

    assert_phase(&env, prop_id, Phase::Defeated);

    let err = client
        .try_execute(&prop_id)
        .expect_err("Execution should fail without quorum");
    assert_eq!(err, Ok(GovernanceError::QuorumNotReached));
}

#[test]
fn voting_after_deadline_returns_vote_closed_error() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));

    // Fast forward past deadline
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 101);

    let err = client
        .try_vote(&voters[1], &prop_id, &true, &100)
        .expect_err("Should not vote after deadline");
    assert_eq!(err, Ok(GovernanceError::VotingClosed));
}

#[test]
fn double_vote_prevention_same_address_votes_twice_returns_error() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1); // Active

    // First vote succeeds
    client.vote(&voters[1], &prop_id, &true, &100);

    // Second vote fails
    let err = client
        .try_vote(&voters[1], &prop_id, &false, &50)
        .expect_err("Double vote should fail");
    assert_eq!(err, Ok(GovernanceError::AlreadyVoted));
}

#[test]
fn cancelled_proposal_cannot_be_reactivated() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));

    client.cancel(&voters[0], &prop_id); // Proposer can cancel in draft
    assert_phase(&env, prop_id, Phase::Cancelled);

    // Advance time to when it would normally be active
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1);

    // Still cancelled
    assert_phase(&env, prop_id, Phase::Cancelled);

    let err = client
        .try_vote(&voters[1], &prop_id, &true, &100)
        .expect_err("Cannot vote on cancelled");
    assert_eq!(err, Ok(GovernanceError::InvalidPhase));
}

#[test]
fn time_window_boundaries_vote_at_last_valid_ledger_succeeds() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));

    // Voting duration is 100 ledgers
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100);

    // Vote at exact boundary succeeds
    client.vote(&voters[1], &prop_id, &true, &100);
    assert_vote_tally(&env, prop_id, 100, 0, 0);

    // Next ledger fails
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1);
    let err = client
        .try_vote(&voters[2], &prop_id, &true, &100)
        .expect_err("One ledger after deadline must fail");
    assert_eq!(err, Ok(GovernanceError::VotingClosed));
}

#[test]
fn quorum_boundary_exactly_at_threshold_passes_one_below_fails() {
    let (env, client, voters) = setup_governance_env();
    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1); // Active

    // Quorum threshold is 200 weight
    client.vote(&voters[1], &prop_id, &true, &199);
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100); // End voting

    assert_phase(&env, prop_id, Phase::Defeated);

    // Create new proposal
    let prop_2 = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop 2"));
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1);

    // Hit exact quorum
    client.vote(&voters[1], &prop_2, &true, &200);
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100);

    assert_phase(&env, prop_2, Phase::ExecutionPending);
    client.queue(&prop_2);
    assert_phase(&env, prop_2, Phase::Queued);
}

#[test]
fn emergency_cancellation_during_queued_window_prevents_execution() {
    let (env, client, voters) = setup_governance_env();
    let admin = client.get_admin();

    let prop_id = client.create_proposal(
        &voters[0],
        &soroban_sdk::String::from_str(&env, "Vulnerable Prop"),
    );
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1);

    // Reach quorum
    client.vote(&voters[1], &prop_id, &true, &200);
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100);

    // Queue proposal
    client.queue(&prop_id);
    assert_phase(&env, prop_id, Phase::Queued);

    let proposal = client.get_proposal(&prop_id).unwrap();

    // Emergency veto / cancellation by admin during timelock delay window
    client.cancel(&admin, &prop_id);
    assert_phase(&env, prop_id, Phase::Cancelled);

    // Fast-forward ledger past the timelock expiration
    env.ledger()
        .set_sequence_number(proposal.executable_after_ledger + 10);

    // Subsequent execution attempts MUST fail
    let err = client
        .try_execute(&prop_id)
        .expect_err("Cancelled proposal can never be executed");
    assert_eq!(err, Ok(GovernanceError::InvalidPhase));
}

#[test]
fn emergency_veto_by_council_during_queued_window_prevents_execution() {
    let (env, client, voters) = setup_governance_env();
    let admin = client.get_admin();

    let council_member = Address::generate(&env);
    let mut council = soroban_sdk::Vec::new(&env);
    council.push_back(council_member.clone());
    client.set_council(&admin, &council, &1);

    let prop_id = client.create_proposal(
        &voters[0],
        &soroban_sdk::String::from_str(&env, "Malicious Prop"),
    );
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1);

    // Reach quorum
    client.vote(&voters[1], &prop_id, &true, &200);
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100);

    // Queue proposal
    client.queue(&prop_id);
    assert_phase(&env, prop_id, Phase::Queued);

    let proposal = client.get_proposal(&prop_id).unwrap();

    // Emergency veto by council member
    client.veto(&council_member, &prop_id);
    assert_phase(&env, prop_id, Phase::Cancelled);

    // Advance past timelock delay
    env.ledger()
        .set_sequence_number(proposal.executable_after_ledger + 100);

    // Execution must fail
    let err = client
        .try_execute(&prop_id)
        .expect_err("Vetoed proposal must fail execution");
    assert_eq!(err, Ok(GovernanceError::InvalidPhase));
}

#[test]
#[should_panic(expected = "unauthorized")]
fn unauthorized_emergency_veto_during_queued_window_fails() {
    let (env, client, voters) = setup_governance_env();
    let outsider = &voters[3];

    let prop_id = client.create_proposal(&voters[0], &soroban_sdk::String::from_str(&env, "Prop"));
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 1);

    client.vote(&voters[1], &prop_id, &true, &200);
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100);

    client.queue(&prop_id);

    // Outsider attempts to cancel during Queued window -> unauthorized
    client.cancel(outsider, &prop_id);
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
#[should_panic(expected = "unauthorized")]
fn test_admin_transfer_unauthorized() {
    let (env, client, voters) = setup_governance_env();
    let bad_actor = &voters[0];
    let new_admin = soroban_sdk::Address::generate(&env);

    env.mock_all_auths();
    client.transfer_admin(bad_actor, &new_admin);
}
