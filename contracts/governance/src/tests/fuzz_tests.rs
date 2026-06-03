//! FUZZ APPROACH: Option A — proptest
//! Rationale: Proptest allows us to discover unanticipated edge cases in quorum math and automatically shrinks failures to minimal counterexamples, which is critical for securing state-heavy governance systems.

#![cfg(test)]

use proptest::prelude::*;
use crate::ProposalMath;

proptest! {
    #[test]
    fn vote_weight_calculations_never_silently_overflow(
        weight_1 in 0u64..=u64::MAX,
        weight_2 in 0u64..=u64::MAX
    ) {
        // We test the underlying math functions directly for arithmetic overflows.
        // The implementation MUST use checked_add, otherwise this test will panic and fail.
        let result = ProposalMath::calculate_total_weight(weight_1, weight_2);
        
        if weight_1.checked_add(weight_2).is_none() {
            prop_assert!(result.is_err(), "Silent overflow detected! Expected an error.");
        } else {
            prop_assert!(result.is_ok(), "Expected success for valid addition.");
            prop_assert_eq!(result.unwrap(), weight_1 + weight_2);
        }
    }

    #[test]
    fn quorum_percentage_edge_cases_calculate_correctly(
        total_supply in 1u64..=u64::MAX,
        quorum_basis_points in 0u32..=20000u32 // 0% to 200%
    ) {
        let required = ProposalMath::calculate_quorum(total_supply, quorum_basis_points);
        
        if quorum_basis_points == 0 {
            prop_assert_eq!(required.unwrap(), 0);
        } else if quorum_basis_points > 10000 {
            prop_assert!(required.is_err(), "Quorum > 100% should be rejected.");
        } else {
            prop_assert!(required.is_ok());
            // Verifies the underlying `(total * bps) / 10000` math doesn't overflow internally 
            // when total_supply is near u64::MAX. Requires u128 casting internally.
        }
    }

    #[test]
    fn time_window_durations_do_not_overflow_ledger_sequences(
        current_sequence in 0u32..=u32::MAX,
        duration in 0u32..=u32::MAX
    ) {
        let end_sequence = ProposalMath::calculate_deadline(current_sequence, duration);
        if current_sequence.checked_add(duration).is_none() {
            prop_assert!(end_sequence.is_err());
        } else {
            prop_assert_eq!(end_sequence.unwrap(), current_sequence + duration);
        }
    }
}
