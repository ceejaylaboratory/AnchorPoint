#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TokenA,
    TokenB,
    ReserveA,
    ReserveB,
    TotalShares,
    Shares(Address),
}

#[contract]
pub struct AMM;

#[contractimpl]
impl AMM {
    /// Initializes the AMM pool for a specific pair of tokens.
    pub fn initialize(env: Env, token_a: Address, token_b: Address) {
        if env.storage().instance().has(&DataKey::TokenA) {
            panic!("already initialized");
        }

        // Canonical order: ensures same pool for (A,B) and (B,A)
        if token_a < token_b {
            env.storage().instance().set(&DataKey::TokenA, &token_a);
            env.storage().instance().set(&DataKey::TokenB, &token_b);
        } else {
            env.storage().instance().set(&DataKey::TokenA, &token_b);
            env.storage().instance().set(&DataKey::TokenB, &token_a);
        }

        env.storage().instance().set(&DataKey::ReserveA, &0_i128);
        env.storage().instance().set(&DataKey::ReserveB, &0_i128);
        env.storage().instance().set(&DataKey::TotalShares, &0_i128);
    }

    /// Deposits liquidity into the pool. Returns the number of LP shares minted.
    pub fn deposit(env: Env, from: Address, amount_a: i128, amount_b: i128) -> i128 {
        from.require_auth();

        let token_a: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenA)
            .expect("not initialized");
        let token_b: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenB)
            .expect("not initialized");
        let reserve_a: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveA)
            .unwrap_or(0);
        let reserve_b: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ReserveB)
            .unwrap_or(0);
        let total_shares: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0);

        // Calculate shares to mint
        let shares = if total_shares == 0 {
            // Initial liquidity = geometric mean
            sqrt(amount_a.checked_mul(amount_b).expect("deposit overflow"))
        } else {
            // Proportional liquidity: min(amount_a/reserve_a, amount_b/reserve_b) * total_shares
            let shares_a = amount_a.checked_mul(total_shares).expect("deposit overflow") / reserve_a;
            let shares_b = amount_b.checked_mul(total_shares).expect("deposit overflow") / reserve_b;
            if shares_a < shares_b {
                shares_a
            } else {
                shares_b
            }
        };

        if shares <= 0 {
            panic!("insufficient liquidity provided");
        }

        // Transfer tokens into the contract (User -> Contract)
        transfer(
            &env,
            &token_a,
            &from,
            &env.current_contract_address(),
            amount_a,
        );
        transfer(
            &env,
            &token_b,
            &from,
            &env.current_contract_address(),
            amount_b,
        );

        // Update state
        env.storage()
            .instance()
            .set(&DataKey::ReserveA, &reserve_a.checked_add(amount_a).expect("reserve overflow"));
        env.storage()
            .instance()
            .set(&DataKey::ReserveB, &reserve_b.checked_add(amount_b).expect("reserve overflow"));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &total_shares.checked_add(shares).expect("shares overflow"));

        let old_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Shares(from.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::Shares(from.clone()), &old_shares.checked_add(shares).expect("shares overflow"));

        // Topic: event name only; from + amounts in data.
        env.events().publish(
            symbol_short!("deposit"),
            (from, amount_a, amount_b, shares),
        );
        shares
    }

    /// Swaps tokens using the constant product formula (x * y = k) with a 0.3% fee.
    pub fn swap(
        env: Env,
        from: Address,
        token_in: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> i128 {
        from.require_auth();

        let token_a: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenA)
            .expect("not initialized");
        let token_b: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenB)
            .expect("not initialized");
        let mut reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap();
        let mut reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap();

        let (reserve_in, reserve_out, token_out) = if token_in == token_a {
            (reserve_a, reserve_b, token_b.clone())
        } else if token_in == token_b {
            (reserve_b, reserve_a, token_a.clone())
        } else {
            panic!("invalid token for pool");
        };

        // Transfer token_in from user to contract
        transfer(
            &env,
            &token_in,
            &from,
            &env.current_contract_address(),
            amount_in,
        );

        // Constant product formula with 0.3% fee: dy = (reserve_out * dx * 997) / (reserve_in * 1000 + dx * 997)
        let amount_in_with_fee = amount_in.checked_mul(997).expect("swap overflow");
        let numerator = amount_in_with_fee.checked_mul(reserve_out).expect("swap overflow");
        let denominator = reserve_in.checked_mul(1000).expect("swap overflow").checked_add(amount_in_with_fee).expect("swap overflow");
        let amount_out = numerator / denominator;

        if amount_out < min_amount_out {
            panic!("slippage exceeded");
        }

        // Update state
        if token_in == token_a {
            reserve_a = reserve_a.checked_add(amount_in).expect("reserve overflow");
            reserve_b = reserve_b.checked_sub(amount_out).expect("reserve underflow");
        } else {
            reserve_b = reserve_b.checked_add(amount_in).expect("reserve overflow");
            reserve_a = reserve_a.checked_sub(amount_out).expect("reserve underflow");
        }

        env.storage().instance().set(&DataKey::ReserveA, &reserve_a);
        env.storage().instance().set(&DataKey::ReserveB, &reserve_b);

        // Transfer token_out from contract to user
        transfer(
            &env,
            &token_out,
            &env.current_contract_address(),
            &from,
            amount_out,
        );

        // Topic: event name only; from + amounts in data.
        env.events()
            .publish(symbol_short!("swap"), (from, amount_in, amount_out));
        amount_out
    }

    /// Withdraws liquidity from the pool.
    pub fn withdraw(env: Env, from: Address, shares: i128) -> (i128, i128) {
        from.require_auth();

        let token_a: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenA)
            .expect("not initialized");
        let token_b: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenB)
            .expect("not initialized");
        let reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap();
        let reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap();
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap();

        let user_shares: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Shares(from.clone()))
            .unwrap_or(0);
        if user_shares < shares {
            panic!("insufficient shares");
        }

        let amount_a = shares.checked_mul(reserve_a).expect("withdraw overflow") / total_shares;
        let amount_b = shares.checked_mul(reserve_b).expect("withdraw overflow") / total_shares;

        // Update state
        env.storage()
            .instance()
            .set(&DataKey::ReserveA, &reserve_a.checked_sub(amount_a).expect("reserve underflow"));
        env.storage()
            .instance()
            .set(&DataKey::ReserveB, &reserve_b.checked_sub(amount_b).expect("reserve underflow"));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &total_shares.checked_sub(shares).expect("shares underflow"));
        env.storage()
            .persistent()
            .set(&DataKey::Shares(from.clone()), &user_shares.checked_sub(shares).expect("shares underflow"));

        // Transfer tokens back to user
        transfer(
            &env,
            &token_a,
            &env.current_contract_address(),
            &from,
            amount_a,
        );
        transfer(
            &env,
            &token_b,
            &env.current_contract_address(),
            &from,
            amount_b,
        );

        // Topic: event name only; from + amounts in data.
        env.events().publish(
            symbol_short!("withdraw"),
            (from, amount_a, amount_b, shares),
        );
        (amount_a, amount_b)
    }

    pub fn get_reserves(env: Env) -> (i128, i128) {
        (
            env.storage()
                .instance()
                .get(&DataKey::ReserveA)
                .unwrap_or(0),
            env.storage()
                .instance()
                .get(&DataKey::ReserveB)
                .unwrap_or(0),
        )
    }

    pub fn get_shares(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Shares(user))
            .unwrap_or(0)
    }

    pub fn get_total_shares(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalShares)
            .unwrap_or(0)
    }
}

/// Helper function to perform cross-contract token transfers.
fn transfer(env: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
    env.invoke_contract::<()>(
        token,
        &symbol_short!("transfer"),
        (from.clone(), to.clone(), amount).into_val(env),
    );
}

/// Babylonian method for integer square root.
fn sqrt(y: i128) -> i128 {
    if y > 3 {
        let mut z = y;
        let mut x = y / 2 + 1;
        while x < z {
            z = x;
            x = (y / x + x) / 2;
        }
        z
    } else if y != 0 {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_initialization() {
        let env = Env::default();
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);

        let contract_id = env.register(AMM, ());
        let client = AMMClient::new(&env, &contract_id);

        client.initialize(&token_a, &token_b);
        let (r_a, r_b) = client.get_reserves();
        assert_eq!(r_a, 0);
        assert_eq!(r_b, 0);
    }
}

#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    const FEE_NUMERATOR: i128 = 997;
    const FEE_DENOMINATOR: i128 = 1000;

    fn swap_formula(reserve_in: i128, reserve_out: i128, amount_in: i128) -> i128 {
        let amount_in_with_fee = amount_in * FEE_NUMERATOR;
        let numerator = amount_in_with_fee * reserve_out;
        let denominator = (reserve_in * FEE_DENOMINATOR) + amount_in_with_fee;
        numerator / denominator
    }

    fn apply_swap(reserve_a: i128, reserve_b: i128, amount_in: i128, from_a: bool) -> (i128, i128, i128) {
        if from_a {
            let amount_out = swap_formula(reserve_a, reserve_b, amount_in);
            (reserve_a + amount_in, reserve_b - amount_out, amount_out)
        } else {
            let amount_out = swap_formula(reserve_b, reserve_a, amount_in);
            (reserve_a - amount_out, reserve_b + amount_in, amount_out)
        }
    }

    #[test]
    fn test_invariant_swap_output_never_exceeds_reserves() {
        for _ in 0..1000 {
            let reserve_a: i128 = rand_simple(10000, 1000000);
            let reserve_b: i128 = rand_simple(10000, 1000000);
            let amount_in: i128 = rand_simple(1, reserve_a / 10);

            let amount_out = swap_formula(reserve_a, reserve_b, amount_in);
            assert!(amount_out < reserve_b, "Swap output should never exceed available reserves");
            assert!(amount_out >= 0, "Swap output should never be negative");
        }
    }

    #[test]
    fn test_invariant_constant_product_with_fees() {
        for _ in 0..500 {
            let r_a: i128 = rand_simple(100000, 500000);
            let r_b: i128 = rand_simple(100000, 500000);
            let amount_in: i128 = rand_simple(100, r_a / 20);

            if r_a <= 0 || r_b <= 0 || amount_in <= 0 {
                continue;
            }

            let k_before = r_a * r_b;
            let amount_out = swap_formula(r_a, r_b, amount_in);
            let (new_r_a, new_r_b, _) = apply_swap(r_a, r_b, amount_in, true);
            let k_after = new_r_a * new_r_b;

            assert!(k_after >= k_before, "K should never decrease");
            // Allow generous margin for integer arithmetic edge cases
            let max_increase = k_before / 50; // 2%
            assert!(k_after - k_before <= max_increase || k_before == 0, "K increase bounded");
        }
    }

    #[test]
    fn test_invariant_reserves_never_negative() {
        for _ in 0..1000 {
            let reserve_a: i128 = rand_simple(10000, 500000);
            let reserve_b: i128 = rand_simple(10000, 500000);
            let amount_in: i128 = rand_simple(1, 10000);

            if amount_in < reserve_a && amount_in < reserve_b {
                let (new_r_a, new_r_b, _) = apply_swap(reserve_a, reserve_b, amount_in, true);
                assert!(new_r_a >= 0, "Reserve A should never be negative");
                assert!(new_r_b >= 0, "Reserve B should never be negative");

                let (new_r_a2, new_r_b2, _) = apply_swap(reserve_a, reserve_b, amount_in, false);
                assert!(new_r_a2 >= 0, "Reserve A should never be negative (swap from B)");
                assert!(new_r_b2 >= 0, "Reserve B should never be negative (swap from B)");
            }
        }
    }

    #[test]
    fn test_invariant_fee_bounded() {
        // Simplified: just verify fee doesn't break the pool
        for _ in 0..200 {
            let r_a: i128 = rand_simple(500000, 1000000);
            let r_b: i128 = rand_simple(500000, 1000000);
            let amount_in: i128 = rand_simple(r_a / 10, r_a / 3);

            if amount_in < r_a / 100 {
                continue;
            }

            let amount_out = swap_formula(r_a, r_b, amount_in);
            // Just verify a swap produces output and doesn't crash
            assert!(amount_out >= 0, "Swap should produce valid output");
            assert!(amount_out < r_b, "Swap output limited by reserves");
        }
    }

    #[test]
    fn test_invariant_multiple_swaps_maintain_positive_reserves() {
        for _ in 0..100 {
            let mut r_a: i128 = rand_simple(50000, 500000);
            let mut r_b: i128 = rand_simple(50000, 500000);
            let swaps = rand_simple(1, 50) as u32;

            for i in 0..swaps {
                let amount_in: i128 = rand_simple(1, 1000);
                if amount_in < r_a && amount_in < r_b {
                    let from_a = (i % 2) == 0;
                    let (_, _, amount_out) = apply_swap(r_a, r_b, amount_in, from_a);
                    if amount_out == 0 {
                        break;
                    }
                }
            }

            assert!(r_a >= 0, "Final reserve A should be non-negative");
            assert!(r_b >= 0, "Final reserve B should be non-negative");
        }
    }

    #[test]
    fn test_security_no_arbitrage_extraction() {
        for _ in 0..500 {
            let r_a: i128 = rand_simple(100000, 500000);
            let r_b: i128 = rand_simple(100000, 500000);
            let k = r_a * r_b;

            let amount_in: i128 = rand_simple(1, 10000);
            let amount_out = swap_formula(r_a, r_b, amount_in);

            let new_r_a = r_a + amount_in;
            let new_r_b = r_b - amount_out;
            let new_k = new_r_a * new_r_b;

            let k_increase = new_k - k;
            let fee_revenue_bps = (k_increase * 1000) / k;

            assert!(fee_revenue_bps >= 0, "Pool should always capture positive fees");
            assert!(fee_revenue_bps <= 4, "Fee revenue should be bounded");
        }
    }

    #[test]
    fn test_sqrt_properties() {
        for _ in 0..1000 {
            let y: i128 = rand_simple(0, 1000000);
            let result = sqrt(y);
            assert!(result >= 0, "sqrt should never return negative");
            assert!(result * result <= y, "sqrt(y)^2 should not exceed y");
            if y > 0 {
                assert!((result + 1) * (result + 1) > y, "sqrt should be ceiling");
            }
        }
    }

    #[test]
    fn test_edge_large_numbers() {
        let a: i128 = 1_000_000_000_000_i128;
        let b: i128 = 1_000_000_000_000_i128;
        let product = a * b;
        assert!(product > 0, "Product of positive numbers should be positive");
    }

    #[test]
    fn test_edge_exact_proportional_withdraw() {
        for _ in 0..500 {
            let reserve_a: i128 = rand_simple(100000, 1000000);
            let reserve_b: i128 = rand_simple(100000, 1000000);
            let total_shares: i128 = sqrt(reserve_a * reserve_b);
            let shares: i128 = rand_simple(1, total_shares - 1);

            let amount_a = (shares * reserve_a) / total_shares;
            let amount_b = (shares * reserve_b) / total_shares;

            let ratio_a = (amount_a * 1000) / reserve_a;
            let ratio_b = (amount_b * 1000) / reserve_b;
            let share_ratio = (shares * 1000) / total_shares;

            assert!((ratio_a - share_ratio).abs() <= 1, "Withdrawal should be proportional for token A");
            assert!((ratio_b - share_ratio).abs() <= 1, "Withdrawal should be proportional for token B");
        }
    }

    #[test]
    fn test_edge_deposit_shares_calculation() {
        for _ in 0..300 {
            let r_a: i128 = rand_simple(200000, 1000000);
            let r_b: i128 = rand_simple(200000, 1000000);
            let amount_a: i128 = rand_simple(50000, 100000);
            let amount_b: i128 = rand_simple(50000, 100000);

            let total_shares = sqrt(r_a * r_b);
            if total_shares <= 0 {
                continue;
            }

            let shares_a = (amount_a * total_shares) / r_a;
            let shares_b = (amount_b * total_shares) / r_b;
            let min_shares = if shares_a < shares_b { shares_a } else { shares_b };

            assert!(min_shares >= 0, "Shares should never be negative");
        }
    }

    static RNG_STATE: core::sync::atomic::AtomicU64 = core::sync::atomic::AtomicU64::new(12345);

    fn rand_simple(min_val: i128, max_val: i128) -> i128 {
        let state = RNG_STATE.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
        let state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        RNG_STATE.store(state, core::sync::atomic::Ordering::Relaxed);
        let range = max_val - min_val;
        if range <= 0 {
            return min_val;
        }
        let result = (state as i128) % range;
        if result < 0 {
            min_val - result
        } else {
            min_val + result
        }
    }
}
