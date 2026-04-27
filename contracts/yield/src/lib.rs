//! Yield Distribution & Reward Sharing Contract
//!
//! Uses the "reward-per-token accumulator" pattern to achieve O(1) reward
//! calculation per user, avoiding O(n) iteration over all holders.
//!
//! Core invariant:
//!   reward_debt[user] = stake[user] * reward_per_token_stored
//!
//! Pending rewards for a user:
//!   pending = stake[user] * (reward_per_token_stored - reward_per_token_paid[user])
//!                         / PRECISION
//!             + rewards[user]

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env};

// Fixed-point precision: 1e18
const PRECISION: i128 = 1_000_000_000_000_000_000;

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Address of the staking token
    StakeToken,
    /// Address of the reward token
    RewardToken,
    /// Contract admin
    Admin,
    /// Total tokens staked across all users
    TotalStaked,
    /// Global accumulated reward per staked token (scaled by PRECISION)
    RewardPerTokenStored,
    /// Per-user staked balance
    Stake(Address),
    /// Snapshot of RewardPerTokenStored at the last time a user interacted
    UserRewardPerTokenPaid(Address),
    /// Accrued but unclaimed rewards for a user
    Rewards(Address),
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct YieldDistribution;

#[contractimpl]
impl YieldDistribution {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    // ── Admin / initialisation ────────────────────────────────────────────

    /// Initialise the contract once.
    pub fn initialize(env: Env, admin: Address, stake_token: Address, reward_token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StakeToken, &stake_token);
        env.storage()
            .instance()
            .set(&DataKey::RewardToken, &reward_token);
        env.storage().instance().set(&DataKey::TotalStaked, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::RewardPerTokenStored, &0_i128);
    }

    /// Deposit `amount` of reward tokens into the contract for distribution.
    /// Calling this increases `reward_per_token_stored` proportionally.
    ///
    /// O(1) — no iteration over holders.
    pub fn deposit_rewards(env: Env, from: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        from.require_auth();
        assert!(amount > 0, "amount must be positive");

        let total_staked: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);

        // Transfer reward tokens into the contract
        let reward_token: Address = env.storage().instance().get(&DataKey::RewardToken).unwrap();
        token::Client::new(&env, &reward_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        // If nobody is staking yet, rewards accumulate but can't be distributed —
        // they will be claimable once the first stake occurs (reward_per_token
        // stays 0 until then, so the deposited tokens sit idle).
        if total_staked > 0 {
            let mut rpt: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardPerTokenStored)
                .unwrap_or(0);
            // Δ reward_per_token = amount * PRECISION / total_staked
            rpt = rpt.checked_add(
                amount.checked_mul(PRECISION).expect("rpt overflow") / total_staked
            ).expect("rpt overflow");
            env.storage()
                .instance()
                .set(&DataKey::RewardPerTokenStored, &rpt);
        }

        env.events()
            .publish((symbol_short!("dep_rwd"), from), amount);
    }

    // ── Staking ───────────────────────────────────────────────────────────

    /// Stake `amount` of the staking token.
    pub fn stake(env: Env, user: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        // Settle any pending rewards before changing the stake
        Self::_update_reward(&env, &user);

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &user,
            &env.current_contract_address(),
            &amount,
        );

        let prev: i128 = Self::_stake_of(&env, &user);
        env.storage()
            .persistent()
            .set(&DataKey::Stake(user.clone()), &prev.checked_add(amount).expect("stake overflow"));

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &total.checked_add(amount).expect("total staked overflow"));

        env.events()
            .publish((symbol_short!("staked"), user), amount);
    }

    /// Unstake `amount` of the staking token.
    pub fn unstake(env: Env, user: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let prev = Self::_stake_of(&env, &user);
        assert!(prev >= amount, "insufficient stake");

        Self::_update_reward(&env, &user);

        env.storage()
            .persistent()
            .set(&DataKey::Stake(user.clone()), &prev.checked_sub(amount).expect("stake underflow"));

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &total.checked_sub(amount).expect("total staked underflow"));

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );

        env.events()
            .publish((symbol_short!("unstaked"), user), amount);
    }

    // ── Claiming ──────────────────────────────────────────────────────────

    /// Claim all accrued rewards for `user`.
    pub fn claim(env: Env, user: Address) -> i128 {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        Self::_update_reward(&env, &user);

        let reward: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user.clone()))
            .unwrap_or(0);

        if reward > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::Rewards(user.clone()), &0_i128);

            let reward_token: Address =
                env.storage().instance().get(&DataKey::RewardToken).unwrap();
            token::Client::new(&env, &reward_token).transfer(
                &env.current_contract_address(),
                &user,
                &reward,
            );

            env.events()
                .publish((symbol_short!("claimed"), user), reward);
        }

        reward
    }

    // ── Views ─────────────────────────────────────────────────────────────

    /// Returns the pending (unclaimed) reward for `user`. O(1).
    pub fn pending_rewards(env: Env, user: Address) -> i128 {
        let rpt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerTokenStored)
            .unwrap_or(0);
        let user_rpt: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerTokenPaid(user.clone()))
            .unwrap_or(0);
        let stake = Self::_stake_of(&env, &user);
        let accrued: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user))
            .unwrap_or(0);

        accrued + stake.checked_mul(rpt - user_rpt).expect("rewards overflow") / PRECISION
    }

    pub fn total_staked(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0)
    }

    pub fn stake_of(env: Env, user: Address) -> i128 {
        Self::_stake_of(&env, &user)
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    /// Settle pending rewards into `rewards[user]` and snapshot the current
    /// `reward_per_token_stored` for the user. Must be called before any
    /// operation that changes a user's stake.
    fn _update_reward(env: &Env, user: &Address) {
        let rpt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerTokenStored)
            .unwrap_or(0);

        let user_rpt: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerTokenPaid(user.clone()))
            .unwrap_or(0);

        let stake = Self::_stake_of(env, user);
        let earned = stake.checked_mul(rpt - user_rpt).expect("rewards overflow") / PRECISION;

        if earned > 0 {
            let prev: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Rewards(user.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::Rewards(user.clone()), &prev.checked_add(earned).expect("rewards overflow"));
        }

        // Snapshot current global rate for this user
        env.storage()
            .persistent()
            .set(&DataKey::UserRewardPerTokenPaid(user.clone()), &rpt);
    }

    fn _stake_of(env: &Env, user: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Stake(user.clone()))
            .unwrap_or(0)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env,
    };

    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        // Deploy mock SAC tokens
        let stake_token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let reward_token_id = env.register_stellar_asset_contract_v2(admin.clone());

        let stake_sac = StellarAssetClient::new(&env, &stake_token_id.address());
        let reward_sac = StellarAssetClient::new(&env, &reward_token_id.address());

        // Mint tokens to participants
        stake_sac.mint(&alice, &1_000_000);
        stake_sac.mint(&bob, &1_000_000);
        reward_sac.mint(&admin, &10_000_000);

        let contract_id = env.register_contract(None, YieldDistribution);
        let client = YieldDistributionClient::new(&env, &contract_id);
        client.initialize(
            &admin,
            &stake_token_id.address(),
            &reward_token_id.address(),
        );

        (
            env,
            contract_id,
            admin,
            alice,
            bob,
            reward_token_id.address(),
        )
    }

    #[test]
    fn test_stake_and_claim() {
        let (env, contract_id, admin, alice, _bob, reward_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // Alice stakes 500_000
        client.stake(&alice, &500_000);
        assert_eq!(client.total_staked(), 500_000);

        // Admin deposits 1_000 reward tokens
        client.deposit_rewards(&admin, &1_000);

        // Alice should have all 1_000 pending
        assert_eq!(client.pending_rewards(&alice), 1_000);

        // Alice claims
        let claimed = client.claim(&alice);
        assert_eq!(claimed, 1_000);
        assert_eq!(client.pending_rewards(&alice), 0);

        // Verify token balance
        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 1_000);
    }

    #[test]
    fn test_proportional_split() {
        let (env, contract_id, admin, alice, bob, _) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // Alice: 300_000, Bob: 700_000  →  30% / 70% split
        client.stake(&alice, &300_000);
        client.stake(&bob, &700_000);

        client.deposit_rewards(&admin, &1_000);

        // Allow rounding: 300 / 700
        assert_eq!(client.pending_rewards(&alice), 300);
        assert_eq!(client.pending_rewards(&bob), 700);
    }

    #[test]
    fn test_rewards_accrue_correctly_after_late_stake() {
        let (env, contract_id, admin, alice, bob, _) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        // Alice stakes first, rewards deposited, then Bob joins
        client.stake(&alice, &500_000);
        client.deposit_rewards(&admin, &1_000);

        // Bob stakes after the first reward deposit
        client.stake(&bob, &500_000);
        client.deposit_rewards(&admin, &1_000);

        // Alice: 1_000 (first round, solo) + 500 (second round, 50/50) = 1_500
        // Bob:   0 (missed first round)    + 500 (second round, 50/50) = 500
        assert_eq!(client.pending_rewards(&alice), 1_500);
        assert_eq!(client.pending_rewards(&bob), 500);
    }

    #[test]
    fn test_unstake_settles_rewards() {
        let (env, contract_id, admin, alice, _bob, reward_token) = setup();
        let client = YieldDistributionClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);
        client.deposit_rewards(&admin, &1_000);

        // Unstake should settle rewards without claiming
        client.unstake(&alice, &500_000);
        assert_eq!(client.stake_of(&alice), 0);
        assert_eq!(client.pending_rewards(&alice), 1_000); // still claimable

        client.claim(&alice);
        let reward_client = TokenClient::new(&env, &reward_token);
        assert_eq!(reward_client.balance(&alice), 1_000);
    }
}
