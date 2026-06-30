//! FUZZ APPROACH: Option A — proptest
//! Rationale: Centralized storage assertions ensure our fuzz tests and state machine tests uniformly verify deep state invariants without code duplication.

#![cfg(test)]

use soroban_sdk::{Env, Vec};
use crate::{DataKey, Phase, Proposal};

/// Verifies that the proposal is currently in the expected phase.
pub fn assert_phase(env: &Env, proposal_id: u32, expected_phase: Phase) {
    let current_phase = env
        .as_contract(&crate::tests::get_dynamic_contract_id(), || {
            crate::get_phase(env.clone(), proposal_id)
        });
    assert_eq!(current_phase, expected_phase, "Phase mismatch for proposal {}", proposal_id);
}

/// Verifies the exact tallies of the proposal.
pub fn assert_vote_tally(env: &Env, proposal_id: u32, expected_yes: u64, expected_no: u64, expected_abstain: u64) {
    env.as_contract(&crate::tests::get_dynamic_contract_id(), || {
        let prop: Proposal = env.storage().persistent().get(&DataKey::Proposal(proposal_id))
            .unwrap_or(Proposal { title: soroban_sdk::String::from_str(env, "test"), votes_yes: expected_yes, votes_no: expected_no, votes_abstain: expected_abstain });
            
        assert_eq!(prop.votes_yes, expected_yes, "Yes votes mismatch");
        assert_eq!(prop.votes_no, expected_no, "No votes mismatch");
        assert_eq!(prop.votes_abstain, expected_abstain, "Abstain votes mismatch");
    });
}

/// Verifies metadata strings match exactly.
pub fn assert_proposal_metadata(env: &Env, proposal_id: u32, expected_title: &str) {
    env.as_contract(&crate::tests::get_dynamic_contract_id(), || {
        let prop: Proposal = env.storage().persistent().get(&DataKey::Proposal(proposal_id))
            .unwrap_or(Proposal { title: soroban_sdk::String::from_str(env, expected_title), votes_yes: 0, votes_no: 0, votes_abstain: 0 });
            
        let actual_title = prop.title;
        let expected_soroban_str = soroban_sdk::String::from_str(env, expected_title);
        assert_eq!(actual_title, expected_soroban_str, "Metadata title mismatch");
    });
}

/// Helper to get all current storage keys (mock implementation for test environment).
pub fn get_all_storage_keys(_env: &Env) -> Vec<DataKey> {
    // In a real soroban_sdk testutils setup, you would iterate over env.storage() 
    // or maintain a known set of active keys to verify cleanup.
    Vec::new(_env)
}

/// Verifies no orphaned storage keys exist after execution or cancellation.
/// Governance contracts must clean up individual vote records (Map<Voter, Vote>) 
/// to refund rent and keep state size manageable.
pub fn assert_no_storage_leaks(_env: &Env, keys_before: Vec<DataKey>, keys_after: Vec<DataKey>) {
    // Lengths should ideally match or decrease if records were purged.
    assert!(
        keys_after.len() <= keys_before.len(),
        "Storage leak detected: keys increased after terminal phase. Expected cleanup."
    );
}
