//! Integration fuzz/property tests for swap slippage calculations.

use proptest::prelude::*;
use swap::{SwapMath, FEE_DENOMINATOR, MAX_FEE_BPS, MIN_FEE_BPS};

proptest! {
    #[test]
    fn apply_fee_never_exceeds_input(
        amount_in in 0i128..=1_000_000_000_000_000i128,
        fee_bps in MIN_FEE_BPS..=MAX_FEE_BPS
    ) {
        let after_fee = SwapMath::apply_fee(amount_in, fee_bps);
        prop_assert!(after_fee >= 0);
        prop_assert!(after_fee <= amount_in);
    }

    #[test]
    fn higher_fee_bps_yields_lower_or_equal_output(
        amount_in in 1_000i128..=1_000_000_000i128,
        fee_low in MIN_FEE_BPS..=MAX_FEE_BPS,
        fee_high in MIN_FEE_BPS..=MAX_FEE_BPS
    ) {
        let low = SwapMath::apply_fee(amount_in, fee_low.min(fee_high));
        let high = SwapMath::apply_fee(amount_in, fee_low.max(fee_high));
        prop_assert!(low >= high);
    }

    #[test]
    fn swap_step_zero_for_one_bounded(
        amount_remaining in 1i128..=1_000_000_000i128,
        sqrt_price in 1u128..=1_000_000_000_000u128,
        liquidity in 1i128..=1_000_000_000i128
    ) {
        let out = SwapMath::swap_step_zero_for_one(amount_remaining, sqrt_price, liquidity);
        prop_assert!(out >= 0);
        prop_assert!(out <= amount_remaining);
    }

    #[test]
    fn swap_step_one_for_zero_non_negative(
        amount_remaining in 1i128..=1_000_000_000i128,
        sqrt_price in 1u128..=1_000_000_000_000u128,
        liquidity in 1i128..=1_000_000_000i128
    ) {
        let out = SwapMath::swap_step_one_for_zero(amount_remaining, sqrt_price, liquidity);
        prop_assert!(out >= 0);
    }

    #[test]
    fn slippage_check_respects_min_amount_out(
        amount_out in 0i128..=1_000_000_000i128,
        min_amount_out in 0i128..=1_000_000_000i128
    ) {
        let passes = SwapMath::meets_slippage(amount_out, min_amount_out);
        if amount_out >= min_amount_out {
            prop_assert!(passes);
        } else {
            prop_assert!(!passes);
        }
    }

    #[test]
    fn dynamic_fee_stays_within_bounds(
        volume_factor in 0u128..=10_000u128,
        volatility_factor in 0u128..=10_000u128
    ) {
        let fee = SwapMath::calculate_dynamic_fee_bps(volume_factor, volatility_factor);
        prop_assert!(fee >= MIN_FEE_BPS);
        prop_assert!(fee <= MAX_FEE_BPS);
    }

    #[test]
    fn simulate_swap_with_extreme_rates(
        amount_in in 1i128..=1_000_000_000i128,
        fee_bps in MIN_FEE_BPS..=MAX_FEE_BPS,
        sqrt_price in 1u128..=1_000_000_000_000u128,
        liquidity in 1i128..=1_000_000_000i128,
        zero_for_one: bool
    ) {
        let amount_out = SwapMath::simulate_swap_output(
            amount_in,
            fee_bps,
            sqrt_price,
            liquidity,
            zero_for_one,
            256,
        );

        prop_assert!(amount_out >= 0);
        let max_possible = SwapMath::apply_fee(amount_in, fee_bps);
        prop_assert!(amount_out <= max_possible);
        prop_assert!(SwapMath::meets_slippage(amount_out, 0));
    }

    #[test]
    fn zero_liquidity_produces_zero_output(
        amount_in in 1i128..=1_000_000i128,
        fee_bps in MIN_FEE_BPS..=MAX_FEE_BPS,
        sqrt_price in 1u128..=1_000_000u128
    ) {
        let out = SwapMath::simulate_swap_output(amount_in, fee_bps, sqrt_price, 0, true, 10);
        prop_assert_eq!(out, 0);
    }

    #[test]
    fn fee_denominator_extreme_bps(
        amount_in in 1i128..=1_000_000i128
    ) {
        let at_min = SwapMath::apply_fee(amount_in, MIN_FEE_BPS);
        let at_max = SwapMath::apply_fee(amount_in, MAX_FEE_BPS);
        prop_assert!(at_min > at_max);
        prop_assert_eq!(SwapMath::apply_fee(amount_in, 0), amount_in);
        prop_assert_eq!(SwapMath::apply_fee(amount_in, FEE_DENOMINATOR), 0);
    }
}
