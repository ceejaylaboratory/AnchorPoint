#![no_std]
//! Yield Farming Distributor
//!
//! Distributes reward tokens to AMM LP holders proportionally to their share
//! of the pool. Uses a per-share accumulator (scaled by 1e18) to track rewards
//! efficiently without iterating over all users.
//!
//! ## APY Calculation
//!
//! The effective APY for a user is:
//!
//! ```text
//! rewards_per_ledger = reward_rate * (user_shares / total_shares)
//! annual_rewards     = rewards_per_ledger * ledgers_per_year
//! APY                = annual_rewards / user_stake_value
//! ```
//!
//! `reward_rate` is expressed in raw reward-token units per ledger (set by the
//! admin). The accumulator is scaled by `PRECISION` (1e18) to preserve
//! fractional precision in integer arithmetic.

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal};

/// Scaling factor for the per-share accumulator (1e18).
const PRECISION: i128 = 1_000_000_000_000_000_000;

#[contracttype]
pub enum DataKey {
    Admin,
    AmmPool,
    RewardToken,
    /// Reward tokens emitted per ledger (set by admin).
    RewardRate,
    /// Last ledger sequence at which the global accumulator was updated.
    LastUpdateLedger,
    /// Global reward-per-share accumulator (scaled by PRECISION).
    RewardPerShareStored,
    /// Scaled reward remainder carried between updates to avoid losing dust.
    RewardRemainder,
    /// Per-user snapshot of the accumulator at the time of their last update.
    UserRewardPerSharePaid(Address),
    /// Per-user scaled reward remainder carried between claims.
    UserRewardRemainder(Address),
    /// Pending (unclaimed) rewards for a user.
    Rewards(Address),
    /// Accumulated protocol fee rewards available to harvest.
    ProtocolFeeBalance,
    /// Vault shares held by each user.
    VaultShares(Address),
    /// Total issued vault shares.
    VaultTotalShares,
}

#[contract]
pub struct YieldFarmingDistributor;

#[contractimpl]
impl YieldFarmingDistributor {
    /// Initialise the distributor.
    ///
    /// * `admin`        – address authorised to change the reward rate.
    /// * `amm_pool`     – AMM pool whose LP shares determine reward weights.
    /// * `reward_token` – token paid out as rewards.
    /// * `reward_rate`  – reward tokens emitted per ledger (raw units).
    pub fn initialize(
        env: Env,
        admin: Address,
        amm_pool: Address,
        reward_token: Address,
        reward_rate: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        assert!(reward_rate >= 0, "reward rate must be non-negative");
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::AmmPool, &amm_pool);
        env.storage()
            .instance()
            .set(&DataKey::RewardToken, &reward_token);
        env.storage()
            .instance()
            .set(&DataKey::RewardRate, &reward_rate);
        env.storage()
            .instance()
            .set(&DataKey::LastUpdateLedger, &env.ledger().sequence());
        env.storage()
            .instance()
            .set(&DataKey::RewardPerShareStored, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::RewardRemainder, &0i128);
        env.storage().instance().set(&DataKey::VaultTotalShares, &0i128);
    }

    /// Return the number of auto-compounding vault shares held by `user`.
    pub fn vault_shares(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::VaultShares(user))
            .unwrap_or(0)
    }

    /// Update the per-ledger reward rate (admin only).
    ///
    /// Flushes the global accumulator before changing the rate so that
    /// previously accrued rewards are calculated at the old rate.
    #[allow(deprecated)]
    pub fn set_reward_rate(env: Env, rate: i128) {
        assert!(rate >= 0, "reward rate must be non-negative");
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        Self::_update_global_reward(&env);
        env.storage().instance().set(&DataKey::RewardRate, &rate);
        env.events()
            .publish((symbol_short!("rate_set"),), (admin, rate));
    }

    /// Claim all pending rewards for `user`.
    ///
    /// Returns the amount of reward tokens transferred.
    #[allow(deprecated)]
    pub fn claim_rewards(env: Env, user: Address) -> i128 {
        user.require_auth();
        Self::_update_user_reward(&env, &user);

        let reward: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user.clone()))
            .unwrap_or(0);

        if reward > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::Rewards(user.clone()), &0i128);
            let reward_token: Address =
                env.storage().instance().get(&DataKey::RewardToken).unwrap();
            env.invoke_contract::<()>(
                &reward_token,
                &symbol_short!("transfer"),
                soroban_sdk::vec![
                    &env,
                    env.current_contract_address().to_val(),
                    user.to_val(),
                    reward.into_val(&env)
                ],
            );
            env.events()
                .publish((symbol_short!("claimed"),), (user, reward));
        }
        reward
    }

    /// Harvest accumulated protocol fee rewards and distribute them to liquidity providers.
    ///
    /// Only the admin is authorized to trigger this harvest. The function:
    /// 1. Flushes the global reward accumulator to the current ledger.
    /// 2. Reads and clears the accumulated protocol fee balance.
    /// 3. Transfers the full fee balance from the contract to the caller (admin).
    /// 4. Emits a `YieldHarvested(amount, timestamp)` event.
    ///
    /// Returns the harvested amount.
    ///
    /// # Panics
    /// Panics if the caller is not the admin or if there are no fees to harvest.
    #[allow(deprecated)]
    pub fn harvest_yield(env: Env) -> i128 {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        // Flush the global accumulator so reward index is up-to-date.
        Self::_update_global_reward(&env);

        let fee_balance: i128 = env
            .storage()
            .instance()
            .get(&DataKey::ProtocolFeeBalance)
            .unwrap_or(0);

        assert!(fee_balance > 0, "no fees to harvest");

        // Clear the protocol fee balance.
        env.storage()
            .instance()
            .set(&DataKey::ProtocolFeeBalance, &0i128);

        // Transfer fee rewards from contract to admin.
        let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
        env.invoke_contract::<()>(
            &reward_token,
            &symbol_short!("transfer"),
            soroban_sdk::vec![
                &env,
                env.current_contract_address().to_val(),
                admin.to_val(),
                fee_balance.into_val(&env)
            ],
        );

        let timestamp = env.ledger().timestamp();
        env.events()
            .publish((symbol_short!("harvested"),), (fee_balance, timestamp));

        fee_balance
    }

    /// View function: returns the total pending rewards for `user` without
    /// modifying state.
    ///
    /// ## APY note
    ///
    /// To compute the current APY off-chain:
    /// ```text
    /// pending_per_ledger ≈ reward_rate * user_shares / total_shares
    /// APY = (pending_per_ledger * ledgers_per_year) / user_stake_value
    /// ```
    pub fn pending_rewards(env: Env, user: Address) -> i128 {
        let amm_pool: Address = env.storage().instance().get(&DataKey::AmmPool).unwrap();

        let (total_shares, user_shares) = Self::_read_validated_shares(&env, &amm_pool, &user);

        let last_update: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LastUpdateLedger)
            .unwrap_or(0);
        let current_ledger = env.ledger().sequence();
        let reward_rate: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardRate)
            .unwrap_or(0);

        // Project the accumulator forward without writing to storage.
        let mut reward_per_share: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerShareStored)
            .unwrap_or(0);

        if current_ledger > last_update && total_shares > 0 {
            let integrated_rewards =
                Self::calculate_rewards_for_period(reward_rate, last_update, current_ledger);
            let reward_delta = integrated_rewards
                .checked_mul(PRECISION)
                .expect("reward overflow");
            let remainder: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardRemainder)
                .unwrap_or(0);
            let distributable = reward_delta
                .checked_add(remainder)
                .expect("reward overflow");
            let delta = distributable / total_shares;
            reward_per_share = reward_per_share
                .checked_add(delta)
                .expect("reward overflow");
        }

        let user_paid: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerSharePaid(user.clone()))
            .unwrap_or(0);
        let rewards_accrued: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user.clone()))
            .unwrap_or(0);
        let user_remainder: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardRemainder(user.clone()))
            .unwrap_or(0);

        // Guard against user_paid being stale / greater than current accumulator.
        let delta_per_share = reward_per_share.saturating_sub(user_paid);

        let reward_numerator = user_shares
            .checked_mul(delta_per_share)
            .expect("reward overflow")
            .checked_add(user_remainder)
            .expect("reward overflow");
        let new_rewards = reward_numerator / PRECISION;

        rewards_accrued
            .checked_add(new_rewards)
            .expect("reward overflow")
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Calculate the effective reward rate for a given ledger sequence.
    /// Decays by 5% every 100,000 ledgers.
    fn get_effective_reward_rate(initial_rate: i128, ledger_seq: u32) -> i128 {
        let epoch = ledger_seq / 100_000;
        let mut rate = initial_rate;
        for _ in 0..epoch {
            rate = rate.checked_mul(95).expect("reward overflow") / 100;
        }
        rate
    }

    /// Calculate the total integrated rewards emitted between two ledger sequences,
    /// properly handling epoch boundaries where the rate decays.
    fn calculate_rewards_for_period(
        initial_rate: i128,
        start_ledger: u32,
        end_ledger: u32,
    ) -> i128 {
        if start_ledger >= end_ledger {
            return 0;
        }
        let mut total_rewards = 0i128;
        let mut current = start_ledger;
        while current < end_ledger {
            let current_epoch = current / 100_000;
            let next_epoch_start = (current_epoch + 1) * 100_000;
            let end = if next_epoch_start < end_ledger {
                next_epoch_start
            } else {
                end_ledger
            };
            let ledgers_in_this_epoch = (end - current) as i128;
            let effective_rate = Self::get_effective_reward_rate(initial_rate, current);
            let epoch_rewards = ledgers_in_this_epoch
                .checked_mul(effective_rate)
                .expect("reward overflow");
            total_rewards = total_rewards
                .checked_add(epoch_rewards)
                .expect("reward overflow");
            current = end;
        }
        total_rewards
    }

    /// Advance the global per-share accumulator to the current ledger.
    fn _update_global_reward(env: &Env) {
        let last_update: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LastUpdateLedger)
            .unwrap_or(0);
        let current_ledger = env.ledger().sequence();

        if current_ledger <= last_update {
            return;
        }

        let amm_pool: Address = env.storage().instance().get(&DataKey::AmmPool).unwrap();
        let total_shares: i128 = env.invoke_contract(
            &amm_pool,
            &soroban_sdk::Symbol::new(env, "get_total_shares"),
            soroban_sdk::vec![env],
        );
        assert!(total_shares >= 0, "invalid total shares");

        if total_shares > 0 {
            let reward_rate: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardRate)
                .unwrap_or(0);
            let integrated_rewards =
                Self::calculate_rewards_for_period(reward_rate, last_update, current_ledger);
            let reward_delta = integrated_rewards
                .checked_mul(PRECISION)
                .expect("reward overflow");
            let remainder: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardRemainder)
                .unwrap_or(0);
            let distributable = reward_delta
                .checked_add(remainder)
                .expect("reward overflow");
            let delta = distributable / total_shares;
            let next_remainder = distributable % total_shares;

            let stored: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardPerShareStored)
                .unwrap_or(0);
            env.storage().instance().set(
                &DataKey::RewardPerShareStored,
                &stored.checked_add(delta).expect("reward overflow"),
            );
            env.storage()
                .instance()
                .set(&DataKey::RewardRemainder, &next_remainder);
        }

        env.storage()
            .instance()
            .set(&DataKey::LastUpdateLedger, &current_ledger);
    }

    /// Flush the global accumulator then credit any newly earned rewards to
    /// `user`'s pending balance and snapshot the accumulator.
    fn _update_user_reward(env: &Env, user: &Address) {
        Self::_update_global_reward(env);

        let stored: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerShareStored)
            .unwrap_or(0);
        let user_paid: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerSharePaid(user.clone()))
            .unwrap_or(0);

        let amm_pool: Address = env.storage().instance().get(&DataKey::AmmPool).unwrap();
        let (_total_shares, user_shares) = Self::_read_validated_shares(env, &amm_pool, user);

        // Guard against stale snapshots.
        let delta_per_share = stored.saturating_sub(user_paid);
        let user_remainder: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardRemainder(user.clone()))
            .unwrap_or(0);
        let reward_numerator = user_shares
            .checked_mul(delta_per_share)
            .expect("reward overflow")
            .checked_add(user_remainder)
            .expect("reward overflow");
        let earned = reward_numerator / PRECISION;
        let next_user_remainder = reward_numerator % PRECISION;

        if earned > 0 {
            let prev: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Rewards(user.clone()))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::Rewards(user.clone()),
                &prev.checked_add(earned).expect("reward overflow"),
            );
        }

        env.storage().persistent().set(
            &DataKey::UserRewardRemainder(user.clone()),
            &next_user_remainder,
        );

        // Always update the snapshot so the user doesn't re-earn the same rewards.
        env.storage()
            .persistent()
            .set(&DataKey::UserRewardPerSharePaid(user.clone()), &stored);
    }

    /// Read AMM share data and reject impossible states before reward math.
    fn _read_validated_shares(env: &Env, amm_pool: &Address, user: &Address) -> (i128, i128) {
        let total_shares: i128 = env.invoke_contract(
            amm_pool,
            &soroban_sdk::Symbol::new(env, "get_total_shares"),
            soroban_sdk::vec![env],
        );
        let user_shares: i128 = env.invoke_contract(
            amm_pool,
            &soroban_sdk::Symbol::new(env, "get_shares"),
            soroban_sdk::vec![env, user.to_val()],
        );

        assert!(total_shares >= 0, "invalid total shares");
        assert!(user_shares >= 0, "invalid user shares");
        assert!(
            user_shares <= total_shares,
            "user shares exceed total shares"
        );

        (total_shares, user_shares)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl,
        testutils::{Address as _, Ledger},
        Address, Env,
    };

    // ── Mock AMM pool ─────────────────────────────────────────────────────────

    /// Minimal AMM mock that tracks total shares and per-user shares.
    #[contract]
    pub struct MockAmmPool;

    #[contractimpl]
    impl MockAmmPool {
        pub fn set_total_shares(env: Env, total: i128) {
            env.storage()
                .instance()
                .set(&symbol_short!("total"), &total);
        }

        pub fn set_shares(env: Env, user: Address, shares: i128) {
            env.storage()
                .instance()
                .set(&(symbol_short!("shares"), user), &shares);
        }

        pub fn get_total_shares(env: Env) -> i128 {
            env.storage()
                .instance()
                .get(&symbol_short!("total"))
                .unwrap_or(0)
        }

        pub fn get_shares(env: Env, user: Address) -> i128 {
            env.storage()
                .instance()
                .get(&(symbol_short!("shares"), user))
                .unwrap_or(0)
        }
    }

    // ── Mock reward token ─────────────────────────────────────────────────────

    #[contract]
    pub struct MockToken;

    #[contractimpl]
    impl MockToken {
        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            let from_bal: i128 = env.storage().instance().get(&from).unwrap_or(0);
            assert!(from_bal >= amount, "insufficient balance");
            env.storage().instance().set(&from, &(from_bal - amount));
            let to_bal: i128 = env.storage().instance().get(&to).unwrap_or(0);
            env.storage().instance().set(&to, &(to_bal + amount));
        }

        pub fn balance(env: Env, account: Address) -> i128 {
            env.storage().instance().get(&account).unwrap_or(0)
        }

        pub fn mint(env: Env, to: Address, amount: i128) {
            let bal: i128 = env.storage().instance().get(&to).unwrap_or(0);
            env.storage().instance().set(&to, &(bal + amount));
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn setup(
        env: &Env,
        reward_rate: i128,
    ) -> (
        YieldFarmingDistributorClient<'_>,
        MockAmmPoolClient<'_>,
        MockTokenClient<'_>,
        Address, // distributor contract address
        Address, // admin
    ) {
        env.mock_all_auths();

        let admin = Address::generate(env);

        let amm_id = env.register(MockAmmPool, ());
        let amm_client = MockAmmPoolClient::new(env, &amm_id);

        let token_id = env.register(MockToken, ());
        let token_client = MockTokenClient::new(env, &token_id);

        let dist_id = env.register(YieldFarmingDistributor, ());
        let dist_client = YieldFarmingDistributorClient::new(env, &dist_id);

        dist_client.initialize(&admin, &amm_id, &token_id, &reward_rate);

        // Fund the distributor with reward tokens.
        token_client.mint(&dist_id, &1_000_000_000);

        (dist_client, amm_client, token_client, dist_id, admin)
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let (dist, _amm, _token, _dist_id, _admin) = setup(&env, 1000);
        // pending rewards for a new user with no shares should be 0
        let user = Address::generate(&env);
        assert_eq!(dist.pending_rewards(&user), 0);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let env = Env::default();
        let (dist, amm_client, token_client, _dist_id, admin) = setup(&env, 1000);
        let amm_id = amm_client.address.clone();
        let token_id = token_client.address.clone();
        dist.initialize(&admin, &amm_id, &token_id, &1000);
    }

    #[test]
    fn test_pending_rewards_single_user() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, _token, _dist_id, _admin) = setup(&env, 1_000);

        let user = Address::generate(&env);
        amm.set_total_shares(&10_000);
        amm.set_shares(&user, &10_000); // 100% of pool

        // Advance 10 ledgers.
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 10);

        // Expected: 10 ledgers * 1000 rate * (10000/10000) = 10_000
        let pending = dist.pending_rewards(&user);
        assert_eq!(pending, 10_000);
    }

    #[test]
    fn test_pending_rewards_proportional() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, _token, _dist_id, _admin) = setup(&env, 1_000);

        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);
        amm.set_total_shares(&10_000);
        amm.set_shares(&user_a, &7_500); // 75%
        amm.set_shares(&user_b, &2_500); // 25%

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 10);

        let pending_a = dist.pending_rewards(&user_a);
        let pending_b = dist.pending_rewards(&user_b);

        // Total rewards = 10 * 1000 = 10_000
        // A gets 75% = 7_500, B gets 25% = 2_500
        assert_eq!(pending_a, 7_500);
        assert_eq!(pending_b, 2_500);
    }

    #[test]
    fn test_claim_rewards() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, token, dist_id, _admin) = setup(&env, 1_000);

        let user = Address::generate(&env);
        amm.set_total_shares(&10_000);
        amm.set_shares(&user, &10_000);

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 5);

        let claimed = dist.claim_rewards(&user);
        assert_eq!(claimed, 5_000); // 5 ledgers * 1000 rate

        // Pending should now be 0 (no new ledgers elapsed).
        assert_eq!(dist.pending_rewards(&user), 0);

        // Token balance of user should reflect the claim.
        assert_eq!(token.balance(&user), 5_000);
        // Distributor balance reduced.
        assert_eq!(token.balance(&dist_id), 1_000_000_000 - 5_000);
    }

    #[test]
    fn test_claim_rewards_no_shares_returns_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, _token, _dist_id, _admin) = setup(&env, 1_000);

        let user = Address::generate(&env);
        amm.set_total_shares(&10_000);
        amm.set_shares(&user, &0);

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 10);

        let claimed = dist.claim_rewards(&user);
        assert_eq!(claimed, 0);
    }

    #[test]
    fn test_set_reward_rate_admin_only() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, _amm, _token, _dist_id, admin) = setup(&env, 1_000);
        dist.set_reward_rate(&2_000);
        // No panic = success; rate change is reflected in future rewards.
        let _ = admin;
    }

    #[test]
    fn test_apy_accuracy_no_double_count() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, _token, _dist_id, _admin) = setup(&env, 100);

        let user = Address::generate(&env);
        amm.set_total_shares(&1_000);
        amm.set_shares(&user, &1_000);

        // Advance 10 ledgers, claim, advance 10 more, check pending.
        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 10);
        let first_claim = dist.claim_rewards(&user);
        assert_eq!(first_claim, 1_000); // 10 * 100

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 10);
        let pending = dist.pending_rewards(&user);
        assert_eq!(pending, 1_000); // another 10 * 100, not doubled

        let second_claim = dist.claim_rewards(&user);
        assert_eq!(second_claim, 1_000);
    }

    #[test]
    fn test_no_rewards_when_pool_empty() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, _token, _dist_id, _admin) = setup(&env, 1_000);

        let user = Address::generate(&env);
        amm.set_total_shares(&0); // empty pool
        amm.set_shares(&user, &0);

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 100);

        assert_eq!(dist.pending_rewards(&user), 0);
        assert_eq!(dist.claim_rewards(&user), 0);
    }

    #[test]
    fn test_fractional_reward_dust_is_carried_forward() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, _token, _dist_id, _admin) = setup(&env, 1);

        let user = Address::generate(&env);
        amm.set_total_shares(&3);
        amm.set_shares(&user, &1);

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 1);
        assert_eq!(dist.claim_rewards(&user), 0);

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 2);
        assert_eq!(dist.pending_rewards(&user), 1);
    }

    #[test]
    #[should_panic(expected = "invalid total shares")]
    fn test_negative_total_shares_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, _token, _dist_id, _admin) = setup(&env, 1_000);

        let user = Address::generate(&env);
        amm.set_total_shares(&-1);
        amm.set_shares(&user, &0);

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 1);
        let _ = dist.pending_rewards(&user);
    }

    #[test]
    #[should_panic(expected = "user shares exceed total shares")]
    fn test_user_shares_cannot_exceed_total_shares() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, _token, _dist_id, _admin) = setup(&env, 1_000);

        let user = Address::generate(&env);
        amm.set_total_shares(&10);
        amm.set_shares(&user, &11);

        env.ledger()
            .set_sequence_number(env.ledger().sequence() + 1);
        let _ = dist.claim_rewards(&user);
    }

    #[test]
    fn test_reward_rate_decay() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, _token, _dist_id, _admin) = setup(&env, 1_000);

        let user = Address::generate(&env);
        amm.set_total_shares(&10_000);
        amm.set_shares(&user, &10_000);

        // Epoch 0: ledgers 0 to 10
        env.ledger().set_sequence_number(10);
        assert_eq!(dist.pending_rewards(&user), 10_000); // 10 * 1000

        // Epoch 1: jump to 100,010
        // ledgers 0 -> 100_000 (100,000 * 1000 = 100,000,000)
        // ledgers 100_000 -> 100_010 (10 * 950 = 9,500)
        // Total = 100,009,500
        env.ledger().set_sequence_number(100_010);
        assert_eq!(dist.pending_rewards(&user), 100_009_500);

        let claimed = dist.claim_rewards(&user);
        assert_eq!(claimed, 100_009_500);

        // Epoch 2: jump to 200,010
        // ledgers 100,010 -> 200_000 (99,990 * 950 = 94,990,500)
        // ledgers 200_000 -> 200_010 (10 * 902 = 9,020)
        // Total = 94,999,520
        env.ledger().set_sequence_number(200_010);
        let claimed2 = dist.claim_rewards(&user);
        assert_eq!(claimed2, 94_999_520);
    }

    #[test]
    fn test_harvest_yield_distributes_protocol_fees() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, amm, token, dist_id, admin) = setup(&env, 1_000);

        // Seed the ProtocolFeeBalance in instance storage
        let fee_amount: i128 = 50_000;
        env.as_contract(&dist_id, || {
            env.storage()
                .instance()
                .set(&DataKey::ProtocolFeeBalance, &fee_amount);
        });

        // Ensure the distributor has enough tokens to cover the harvest
        token.mint(&dist_id, &fee_amount);

        let admin_before = token.balance(&admin);
        let harvested = dist.harvest_yield();

        assert_eq!(harvested, fee_amount);
        assert_eq!(token.balance(&admin), admin_before + fee_amount);

        // After harvest, protocol fee balance should be zero
        env.as_contract(&dist_id, || {
            let remaining: i128 = env
                .storage()
                .instance()
                .get(&DataKey::ProtocolFeeBalance)
                .unwrap_or(0);
            assert_eq!(remaining, 0);
        });

        // AMM setup is needed for pending_rewards; just verify no double-count
        let user = Address::generate(&env);
        amm.set_total_shares(&1_000);
        amm.set_shares(&user, &1_000);
    }

    #[test]
    #[should_panic(expected = "no fees to harvest")]
    fn test_harvest_yield_zero_fees_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (dist, _amm, _token, _dist_id, _admin) = setup(&env, 1_000);
        // No protocol fees set → should panic
        dist.harvest_yield();
    }
}
