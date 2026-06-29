#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
};

// Fixed-point precision: 1e18
const PRECISION: i128 = 1_000_000_000_000_000_000;

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Contract admin
    Admin,
    /// Address of the staking token
    StakeToken,
    /// Total tokens staked across all users
    TotalStaked,
    /// Whether a reward token is whitelisted (bool)
    IsWhitelisted(Address),
    /// List of all whitelisted reward tokens
    RewardTokens,
    /// Global accumulated reward per staked token for a specific reward token (scaled by PRECISION)
    RewardPerTokenStored(Address),
    /// Per-user staked balance
    Stake(Address),
    /// Snapshot of RewardPerTokenStored for a specific user and reward token
    UserRewardPerTokenPaid(Address, Address), // (User, RewardToken)
    /// Accrued but unclaimed rewards for a user and reward token
    Rewards(Address, Address), // (User, RewardToken)
    /// Whether contract is paused for emergency
    Paused,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct MultiTokenStaking;

#[contractimpl]
impl MultiTokenStaking {
    // ── Admin / Initialisation ────────────────────────────────────────────

    /// Initialise the contract once.
    pub fn initialize(env: Env, admin: Address, stake_token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::StakeToken, &stake_token);
        env.storage().instance().set(&DataKey::TotalStaked, &0_i128);
        env.storage().instance().set(&DataKey::Paused, &false);
        
        let reward_tokens: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::RewardTokens, &reward_tokens);
    }

    /// Whitelist a new reward token.
    pub fn add_reward_token(env: Env, admin: Address, reward_token: Address) {
        admin.require_auth();
        let expected_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert_eq!(admin, expected_admin, "unauthorized");
        Self::_check_not_paused(&env);

        let is_whitelisted = env
            .storage()
            .instance()
            .get(&DataKey::IsWhitelisted(reward_token.clone()))
            .unwrap_or(false);

        if !is_whitelisted {
            env.storage()
                .instance()
                .set(&DataKey::IsWhitelisted(reward_token.clone()), &true);

            let mut reward_tokens: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::RewardTokens)
                .unwrap_or_else(|| Vec::new(&env));
            
            reward_tokens.push_back(reward_token.clone());
            env.storage().instance().set(&DataKey::RewardTokens, &reward_tokens);
            env.storage()
                .instance()
                .set(&DataKey::RewardPerTokenStored(reward_token), &0_i128);
        }
    }

    /// Deposit `amount` of a specific reward token into the contract.
    pub fn deposit_rewards(env: Env, from: Address, reward_token: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::_check_not_paused(&env);

        let is_whitelisted = env
            .storage()
            .instance()
            .get(&DataKey::IsWhitelisted(reward_token.clone()))
            .unwrap_or(false);
        assert!(is_whitelisted, "reward token not whitelisted");

        let total_staked: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);

        // Transfer reward tokens into the contract
        token::Client::new(&env, &reward_token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );

        if total_staked > 0 {
            let mut rpt: i128 = env
                .storage()
                .instance()
                .get(&DataKey::RewardPerTokenStored(reward_token.clone()))
                .unwrap_or(0);
            
            rpt = rpt.checked_add(
                amount.checked_mul(PRECISION).expect("rpt overflow") / total_staked
            ).expect("rpt overflow");
            env.storage()
                .instance()
                .set(&DataKey::RewardPerTokenStored(reward_token.clone()), &rpt);
        }

        env.events().publish(
            (symbol_short!("dep_rwd"), from, reward_token),
            amount,
        );
    }

    // ── Admin: Pause/Unpause ─────────────────────────────────────────────

    /// Pause contract operations (emergency).
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let expected_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert_eq!(admin, expected_admin, "unauthorized");
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((symbol_short!("paused"),), ());
    }

    /// Unpause contract operations.
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let expected_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        assert_eq!(admin, expected_admin, "unauthorized");
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((symbol_short!("unpaused"),), ());
    }

    /// Check if contract is paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    // ── Staking ───────────────────────────────────────────────────────────

    pub fn stake(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::_check_not_paused(&env);

        Self::_update_rewards(&env, &user);

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

        env.events().publish((symbol_short!("staked"),), (user, amount));
    }

    pub fn unstake(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::_check_not_paused(&env);

        let prev = Self::_stake_of(&env, &user);
        assert!(prev >= amount, "insufficient stake");

        Self::_update_rewards(&env, &user);

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

        // Topic: event name only; user + amount in data.
        env.events().publish((symbol_short!("unstaked"),), (user, amount));
    }

    // ── Emergency Withdraw ─────────────────────────────────────────────────

    /// Withdraw entire stake directly when contract is paused, without reward updates.
    pub fn emergency_withdraw(env: Env, user: Address) {
        user.require_auth();
        assert!(Self::is_paused(env.clone()), "contract not paused");

        let amount = Self::_stake_of(&env, &user);
        assert!(amount > 0, "no stake to withdraw");

        // Update storage
        env.storage()
            .persistent()
            .set(&DataKey::Stake(user.clone()), &0_i128);

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &total.checked_sub(amount).expect("total staked underflow"));

        // Transfer tokens
        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );

        env.events().publish((symbol_short!("emer_wd"),), (user, amount));
    }

    // ── Claiming ──────────────────────────────────────────────────────────

    /// Claim a specific reward token.
    pub fn claim(env: Env, user: Address, reward_token: Address) -> i128 {
        user.require_auth();
        Self::_check_not_paused(&env);
        Self::_update_reward_for_token(&env, &user, &reward_token);

        let reward: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user.clone(), reward_token.clone()))
            .unwrap_or(0);

        if reward > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::Rewards(user.clone(), reward_token.clone()), &0_i128);

            token::Client::new(&env, &reward_token).transfer(
                &env.current_contract_address(),
                &user,
                &reward,
            );

            env.events()
                .publish((symbol_short!("claimed"), user.clone(), reward_token.clone()), reward);
        }

        reward
    }

    /// Claim all whitelisted reward tokens.
    pub fn claim_all(env: Env, user: Address) {
        user.require_auth();
        Self::_check_not_paused(&env);
        let reward_tokens: Vec<Address> = env.storage().instance().get(&DataKey::RewardTokens).unwrap_or_else(|| Vec::new(&env));
        
        for reward_token in reward_tokens.iter() {
            // Claim each one internally without separate require_auth since it's already done
            Self::_update_reward_for_token(&env, &user, &reward_token);

            let reward: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Rewards(user.clone(), reward_token.clone()))
                .unwrap_or(0);

            if reward > 0 {
                env.storage()
                    .persistent()
                    .set(&DataKey::Rewards(user.clone(), reward_token.clone()), &0_i128);

                token::Client::new(&env, &reward_token).transfer(
                    &env.current_contract_address(),
                    &user,
                    &reward,
                );

                env.events()
                    .publish((symbol_short!("claimed"), user.clone(), reward_token.clone()), reward);
            }
        }
    }

    // ── Views ─────────────────────────────────────────────────────────────

    pub fn pending_rewards(env: Env, user: Address, reward_token: Address) -> i128 {
        let rpt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerTokenStored(reward_token.clone()))
            .unwrap_or(0);
        let user_rpt: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerTokenPaid(user.clone(), reward_token.clone()))
            .unwrap_or(0);
        let stake = Self::_stake_of(&env, &user);
        let accrued: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user, reward_token))
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
    
    pub fn get_whitelisted_tokens(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::RewardTokens).unwrap_or_else(|| Vec::new(&env))
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    fn _check_not_paused(env: &Env) {
        assert!(!Self::is_paused(env.clone()), "contract is paused");
    }

    fn _update_rewards(env: &Env, user: &Address) {
        let reward_tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::RewardTokens)
            .unwrap_or_else(|| Vec::new(env));
            
        for reward_token in reward_tokens.iter() {
            Self::_update_reward_for_token(env, user, &reward_token);
        }
    }

    fn _update_reward_for_token(env: &Env, user: &Address, reward_token: &Address) {
        let rpt: i128 = env
            .storage()
            .instance()
            .get(&DataKey::RewardPerTokenStored(reward_token.clone()))
            .unwrap_or(0);

        let user_rpt: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::UserRewardPerTokenPaid(user.clone(), reward_token.clone()))
            .unwrap_or(0);

        let stake = Self::_stake_of(env, user);
        let earned = stake.checked_mul(rpt - user_rpt).expect("rewards overflow") / PRECISION;

        if earned > 0 {
            let prev: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Rewards(user.clone(), reward_token.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::Rewards(user.clone(), reward_token.clone()), &prev.checked_add(earned).expect("rewards overflow"));
        }

        // Snapshot current global rate for this user
        env.storage()
            .persistent()
            .set(&DataKey::UserRewardPerTokenPaid(user.clone(), reward_token.clone()), &rpt);
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
        testutils::{Address as _},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env,
    };

    fn setup() -> (Env, Address, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let stake_token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let reward_token_1_id = env.register_stellar_asset_contract_v2(admin.clone());
        let reward_token_2_id = env.register_stellar_asset_contract_v2(admin.clone());

        let stake_sac = StellarAssetClient::new(&env, &stake_token_id.address());
        let reward_1_sac = StellarAssetClient::new(&env, &reward_token_1_id.address());
        let reward_2_sac = StellarAssetClient::new(&env, &reward_token_2_id.address());

        stake_sac.mint(&alice, &1_000_000);
        stake_sac.mint(&bob, &1_000_000);
        reward_1_sac.mint(&admin, &10_000_000);
        reward_2_sac.mint(&admin, &10_000_000);

        let contract_id = env.register_contract(None, MultiTokenStaking);
        let client = MultiTokenStakingClient::new(&env, &contract_id);
        client.initialize(&admin, &stake_token_id.address());
        
        client.add_reward_token(&admin, &reward_token_1_id.address());
        client.add_reward_token(&admin, &reward_token_2_id.address());

        (env, contract_id, admin, alice, bob, reward_token_1_id.address(), reward_token_2_id.address())
    }

    #[test]
    fn test_stake_and_claim_multiple() {
        let (env, contract_id, admin, alice, _bob, rwd1, rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);

        client.deposit_rewards(&admin, &rwd1, &1_000);
        client.deposit_rewards(&admin, &rwd2, &2_000);

        assert_eq!(client.pending_rewards(&alice, &rwd1), 1_000);
        assert_eq!(client.pending_rewards(&alice, &rwd2), 2_000);

        client.claim_all(&alice);

        assert_eq!(client.pending_rewards(&alice, &rwd1), 0);
        assert_eq!(client.pending_rewards(&alice, &rwd2), 0);

        let rwd1_client = TokenClient::new(&env, &rwd1);
        let rwd2_client = TokenClient::new(&env, &rwd2);
        assert_eq!(rwd1_client.balance(&alice), 1_000);
        assert_eq!(rwd2_client.balance(&alice), 2_000);
    }

    #[test]
    fn test_proportional_split() {
        let (env, contract_id, admin, alice, bob, rwd1, rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        client.stake(&alice, &300_000);
        client.stake(&bob, &700_000);

        client.deposit_rewards(&admin, &rwd1, &1_000);
        client.deposit_rewards(&admin, &rwd2, &500);

        assert_eq!(client.pending_rewards(&alice, &rwd1), 300);
        assert_eq!(client.pending_rewards(&bob, &rwd1), 700);

        assert_eq!(client.pending_rewards(&alice, &rwd2), 150);
        assert_eq!(client.pending_rewards(&bob, &rwd2), 350);
    }

    #[test]
    fn test_late_joiner() {
        let (env, contract_id, admin, alice, bob, rwd1, _) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);
        client.deposit_rewards(&admin, &rwd1, &1_000);

        client.stake(&bob, &500_000);
        client.deposit_rewards(&admin, &rwd1, &1_000);

        assert_eq!(client.pending_rewards(&alice, &rwd1), 1_500);
        assert_eq!(client.pending_rewards(&bob, &rwd1), 500);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_normal_unstake_when_paused() {
        let (env, contract_id, admin, alice, _bob, _rwd1, _rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);
        client.stake(&alice, &500_000);
        client.pause(&admin);
        client.unstake(&alice, &100_000); // Should panic
    }

    #[test]
    fn test_pause_and_emergency_withdraw() {
        let (env, contract_id, admin, alice, _bob, _rwd1, _rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        // Stake first
        client.stake(&alice, &500_000);
        assert_eq!(client.stake_of(&alice), 500_000);

        // Pause contract
        client.pause(&admin);
        assert!(client.is_paused());

        // Try emergency withdraw - should work
        client.emergency_withdraw(&alice);
        assert_eq!(client.stake_of(&alice), 0);

        // Unpause
        client.unpause(&admin);
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "contract not paused")]
    fn test_emergency_withdraw_not_paused() {
        let (env, contract_id, _admin, alice, _bob, _rwd1, _rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);
        client.stake(&alice, &100_000);
        client.emergency_withdraw(&alice); // Should panic
    }
}
