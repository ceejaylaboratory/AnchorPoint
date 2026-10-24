//! Property-based fuzz tests for the constant-product invariant.
//!
//! Every scenario deploys a fresh pool backed by real Stellar Asset Contract
//! tokens, seeds it with randomized reserves and drives it through a
//! randomized sequence of swaps against the actual `AMM::swap` entry point.
//! After every swap the pool must satisfy `k_after >= k_before` where
//! `k = reserve_a * reserve_b`.
//!
//! Unlike the formula-only checks in `fuzz_tests`, nothing here is wrapped in
//! `catch_unwind`: every generated input is a valid swap, so any panic inside
//! the contract fails the property.

extern crate std;

use super::*;
use proptest::prelude::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use std::format;
use std::vec::Vec;

/// Randomized scenarios per property (the issue asks for 1 000+).
const CASES: u32 = 1_024;
/// Upper bound for a single reserve or swap amount.
const MAX_AMOUNT: i128 = 1_000_000_000_000_000;
/// Enough for the trader to cover the initial deposit plus every swap.
const USER_FUNDS: i128 = 1_000_000_000_000_000_000;
/// `sqrt(a * b)` must exceed the 1 000 minimum liquidity on first deposit.
const MIN_RESERVE: i128 = 1_001;
const MAX_SWAPS: usize = 8;

struct Pool {
    env: Env,
    client: AMMClient<'static>,
    token_a: Address,
    token_b: Address,
    trader: Address,
}

impl Pool {
    fn new(reserve_a: i128, reserve_b: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let trader = Address::generate(&env);
        let first = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let second = env.register_stellar_asset_contract_v2(admin.clone()).address();
        // Mirror the contract's canonical ordering so reserve_a tracks token_a.
        let (token_a, token_b) = if first < second { (first, second) } else { (second, first) };

        StellarAssetClient::new(&env, &token_a).mint(&trader, &USER_FUNDS);
        StellarAssetClient::new(&env, &token_b).mint(&trader, &USER_FUNDS);

        let contract_id = env.register(AMM, ());
        let client = AMMClient::new(&env, &contract_id);
        client.initialize(&admin, &token_a, &token_b);
        client.deposit(&trader, &reserve_a, &reserve_b);

        Pool { env, client, token_a, token_b, trader }
    }

    fn token(&self, a_side: bool) -> &Address {
        if a_side { &self.token_a } else { &self.token_b }
    }

    /// Swap and check the per-swap invariants. Returns `amount_out`.
    fn checked_swap(&self, a_to_b: bool, amount_in: i128) -> Result<i128, TestCaseError> {
        let (r_a, r_b) = self.client.get_reserves();
        let k_before = k(r_a, r_b);
        let (reserve_in, reserve_out) = if a_to_b { (r_a, r_b) } else { (r_b, r_a) };

        let amount_out = self
            .client
            .swap(&self.trader, self.token(a_to_b), &amount_in, &0);

        let (r_a2, r_b2) = self.client.get_reserves();
        let k_after = k(r_a2, r_b2);

        prop_assert!(
            k_after >= k_before,
            "k decreased: {} * {} = {} -> {} * {} = {} (amount_in={}, a_to_b={})",
            r_a, r_b, k_before, r_a2, r_b2, k_after, amount_in, a_to_b
        );
        prop_assert_eq!(amount_out, reference_amount_out(reserve_in, reserve_out, amount_in));
        prop_assert!(amount_out < reserve_out, "swap drained the output reserve");
        prop_assert!(r_a2 > 0 && r_b2 > 0, "reserve hit zero: ({}, {})", r_a2, r_b2);

        // Recorded reserves must match the tokens the pool actually holds.
        let pool_addr = &self.client.address;
        prop_assert_eq!(TokenClient::new(&self.env, &self.token_a).balance(pool_addr), r_a2);
        prop_assert_eq!(TokenClient::new(&self.env, &self.token_b).balance(pool_addr), r_b2);

        Ok(amount_out)
    }
}

fn k(reserve_a: i128, reserve_b: i128) -> i128 {
    reserve_a.checked_mul(reserve_b).expect("k overflow")
}

/// Independent restatement of the 0.3% fee constant-product quote.
fn reference_amount_out(reserve_in: i128, reserve_out: i128, amount_in: i128) -> i128 {
    let amount_in_with_fee = amount_in * 997;
    amount_in_with_fee * reserve_out / (reserve_in * 1000 + amount_in_with_fee)
}

/// Mixes dust, mid-sized and whale-sized values so lopsided pools and trades
/// far larger than the pool are exercised alongside typical ones.
fn amount_strategy(min: i128) -> impl Strategy<Value = i128> {
    prop_oneof![
        min..=100_000i128,
        100_000i128..=1_000_000_000_000i128,
        1_000_000_000_000i128..=MAX_AMOUNT,
    ]
}

fn swaps_strategy() -> impl Strategy<Value = Vec<(bool, i128)>> {
    prop::collection::vec((any::<bool>(), amount_strategy(1)), 1..=MAX_SWAPS)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    /// `k_after >= k_before` holds for every swap in a random sequence.
    #[test]
    fn fuzz_swap_never_decreases_constant_product(
        reserve_a in amount_strategy(MIN_RESERVE),
        reserve_b in amount_strategy(MIN_RESERVE),
        swaps in swaps_strategy(),
    ) {
        let pool = Pool::new(reserve_a, reserve_b);
        let k_initial = k(reserve_a, reserve_b);

        for (a_to_b, amount_in) in swaps {
            pool.checked_swap(a_to_b, amount_in)?;
        }

        let (r_a, r_b) = pool.client.get_reserves();
        prop_assert!(k(r_a, r_b) >= k_initial, "k fell below its initial value over the sequence");
    }

    /// Swapping in and immediately swapping the proceeds back never returns
    /// more than was put in, so the fee can't be bypassed by a round trip.
    #[test]
    fn fuzz_round_trip_swap_is_never_profitable(
        reserve_a in amount_strategy(MIN_RESERVE),
        reserve_b in amount_strategy(MIN_RESERVE),
        a_to_b in any::<bool>(),
        amount_in in amount_strategy(1),
    ) {
        let pool = Pool::new(reserve_a, reserve_b);

        let received = pool.checked_swap(a_to_b, amount_in)?;
        if received > 0 {
            let returned = pool.checked_swap(!a_to_b, received)?;
            prop_assert!(
                returned <= amount_in,
                "round trip returned {} for {} in", returned, amount_in
            );
        }
    }
}
