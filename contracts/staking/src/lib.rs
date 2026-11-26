#![no_std]

use ethnum::U256;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, String,
    Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    CalculationOverflow = 1,
}

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
    /// Branding / project metadata (description, icon_url, website)
    ContractMeta,
    /// Whether contract is paused for emergency
    Paused,
}

/// On-chain branding metadata for the contract.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractMetadata {
    pub description: String,
    pub icon_url: String,
    pub website: String,
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
        env.storage()
            .instance()
            .set(&DataKey::StakeToken, &stake_token);
        env.storage().instance().set(&DataKey::TotalStaked, &0_i128);
        env.storage().instance().set(&DataKey::Paused, &false);

        let reward_tokens: Vec<Address> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::RewardTokens, &reward_tokens);

        env.storage().instance().set(
            &DataKey::ContractMeta,
            &ContractMetadata {
                description: String::from_str(&env, ""),
                icon_url: String::from_str(&env, ""),
                website: String::from_str(&env, ""),
            },
        );
        env.events()
            .publish((symbol_short!("stk_init"),), (admin, stake_token));
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
            env.storage()
                .instance()
                .set(&DataKey::RewardTokens, &reward_tokens);
            env.storage().instance().set(
                &DataKey::RewardPerTokenStored(reward_token.clone()),
                &0_i128,
            );
            env.events()
                .publish((symbol_short!("rwd_add"),), (admin, reward_token));
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

            let amount_u256 = U256::from(amount as u128);
            let prec_u256 = U256::from(PRECISION as u128);
            let staked_u256 = U256::from(total_staked as u128);

            let added_rpt_u256 = amount_u256
                .checked_mul(prec_u256)
                .and_then(|v| v.checked_div(staked_u256))
                .unwrap_or_else(|| panic!("rpt overflow"));

            let added_rpt = if added_rpt_u256 > U256::from(i128::MAX as u128) {
                panic!("rpt overflow")
            } else {
                added_rpt_u256.as_i128()
            };

            rpt = rpt.checked_add(added_rpt).expect("rpt overflow");
            env.storage()
                .instance()
                .set(&DataKey::RewardPerTokenStored(reward_token.clone()), &rpt);
        }

        // Topic: event name only; from + reward_token + amount in data.
        env.events().publish(
            (symbol_short!("dep_rwd"),),
            (from.clone(), reward_token.clone(), amount),
        );
        env.events()
            .publish((symbol_short!("dep_rwd"), from, reward_token), amount);
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
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
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
        env.storage().persistent().set(
            &DataKey::Stake(user.clone()),
            &prev.checked_add(amount).expect("stake overflow"),
        );

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalStaked,
            &total.checked_add(amount).expect("total staked overflow"),
        );

        // Topic: event name only; user + amount in data.
        env.events()
            .publish((symbol_short!("staked"),), (user, amount));
    }

    pub fn unstake(env: Env, user: Address, amount: i128) {
        user.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::_check_not_paused(&env);

        let prev = Self::_stake_of(&env, &user);
        assert!(prev >= amount, "insufficient stake");

        Self::_update_rewards(&env, &user);

        env.storage().persistent().set(
            &DataKey::Stake(user.clone()),
            &prev.checked_sub(amount).expect("stake underflow"),
        );

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TotalStaked,
            &total.checked_sub(amount).expect("total staked underflow"),
        );

        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );

        // Topic: event name only; user + amount in data.
        env.events()
            .publish((symbol_short!("unstaked"),), (user, amount));
    }

    // ── Emergency Withdraw ─────────────────────────────────────────────────

    /// Withdraw entire stake directly when contract is paused, without reward updates.
    /// This function is EXCLUSIVELY available when the contract is paused.
    pub fn emergency_withdraw(env: Env, user: Address) {
        user.require_auth();
        Self::_require_paused(&env);

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
        env.storage().instance().set(
            &DataKey::TotalStaked,
            &total.checked_sub(amount).expect("total staked underflow"),
        );

        // Transfer tokens
        let stake_token: Address = env.storage().instance().get(&DataKey::StakeToken).unwrap();
        token::Client::new(&env, &stake_token).transfer(
            &env.current_contract_address(),
            &user,
            &amount,
        );

        env.events()
            .publish((symbol_short!("emer_wd"),), (user, amount));
    }

    // ── Claiming ──────────────────────────────────────────────────────────

    /// Claim a specific reward token.
    pub fn claim(env: Env, user: Address, reward_token: Address) -> i128 {
        user.require_auth();
        Self::_check_not_paused(&env);
        Self::_update_reward_for_token(&env, &user, &reward_token);

        let accrued: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user.clone(), reward_token.clone()))
            .unwrap_or(0);

        // Divide the scaled accrued amount into whole tokens and keep the
        // sub-stroop remainder so it is not lost (and not locked up).
        let reward = accrued.checked_div(PRECISION).unwrap_or(0);
        let remainder = accrued.checked_rem(PRECISION).unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::Rewards(user.clone(), reward_token.clone()),
            &remainder,
        );

        if reward > 0 {
            token::Client::new(&env, &reward_token).transfer(
                &env.current_contract_address(),
                &user,
                &reward,
            );
        }

        env.events().publish(
            (symbol_short!("claimed"), user.clone(), reward_token.clone()),
            reward,
        );
        env.events()
            .publish((symbol_short!("claimed"),), (user, reward_token, reward));

        reward
    }

    /// Claim all whitelisted reward tokens.
    pub fn claim_all(env: Env, user: Address) {
        user.require_auth();
        Self::_check_not_paused(&env);
        let reward_tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::RewardTokens)
            .unwrap_or_else(|| Vec::new(&env));

        for reward_token in reward_tokens.iter() {
            // Claim each one internally without separate require_auth since it's already done
            Self::_update_reward_for_token(&env, &user, &reward_token);

            let accrued: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Rewards(user.clone(), reward_token.clone()))
                .unwrap_or(0);

            // Divide the scaled accrued amount and store the sub-stroop remainder.
            let reward = accrued.checked_div(PRECISION).unwrap_or(0);
            let remainder = accrued.checked_rem(PRECISION).unwrap_or(0);

            env.storage().persistent().set(
                &DataKey::Rewards(user.clone(), reward_token.clone()),
                &remainder,
            );

            if reward > 0 {
                token::Client::new(&env, &reward_token).transfer(
                    &env.current_contract_address(),
                    &user,
                    &reward,
                );
            }
            env.events().publish(
                (symbol_short!("claimed"), user.clone(), reward_token.clone()),
                reward,
            );
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
            .get(&DataKey::UserRewardPerTokenPaid(
                user.clone(),
                reward_token.clone(),
            ))
            .unwrap_or(0);
        let stake = Self::_stake_of(&env, &user);
        let accrued: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Rewards(user, reward_token))
            .unwrap_or(0);

        let delta_rpt = rpt.checked_sub(user_rpt).unwrap_or(0);
        let delta = if delta_rpt > 0 && stake > 0 {
            let num = U256::from(stake as u128)
                .checked_mul(U256::from(delta_rpt as u128))
                .unwrap_or_else(|| panic!("rewards overflow"));
            if num > U256::from(i128::MAX as u128) {
                panic!("rewards overflow");
            }
            num.as_i128()
        } else {
            0
        };

        let total_accrued = accrued
            .checked_add(delta)
            .unwrap_or_else(|| panic!("rewards overflow"));
        total_accrued.checked_div(PRECISION).unwrap_or(0)
    }

    /// Standalone reward calculation using 256-bit fixed-point arithmetic to prevent intermediate overflow.
    pub fn calculate_rewards(
        amount: i128,
        rate: i128,
        elapsed_seconds: u64,
        rate_multiplier: i128,
        emission_bps: i128,
    ) -> Result<i128, Error> {
        if amount == 0 || elapsed_seconds == 0 {
            return Ok(0);
        }
        if amount < 0 || rate < 0 || rate_multiplier < 0 || emission_bps < 0 {
            return Err(Error::CalculationOverflow);
        }

        let amount_u256 = U256::from(amount as u128);
        let rate_u256 = U256::from(rate as u128);
        let seconds_u256 = U256::from(elapsed_seconds);
        let mult_u256 = U256::from(rate_multiplier as u128);
        let emission_u256 = U256::from(emission_bps as u128);

        let numerator = amount_u256
            .checked_mul(rate_u256)
            .ok_or(Error::CalculationOverflow)?
            .checked_mul(seconds_u256)
            .ok_or(Error::CalculationOverflow)?
            .checked_mul(mult_u256)
            .ok_or(Error::CalculationOverflow)?
            .checked_mul(emission_u256)
            .ok_or(Error::CalculationOverflow)?;

        let denominator = U256::from(
            10_000_000u128
                .checked_mul(100)
                .ok_or(Error::CalculationOverflow)?
                .checked_mul(10_000)
                .ok_or(Error::CalculationOverflow)?,
        );

        let quotient = numerator
            .checked_div(denominator)
            .ok_or(Error::CalculationOverflow)?;

        if quotient > U256::from(i128::MAX as u128) {
            return Err(Error::CalculationOverflow);
        }

        Ok(quotient.as_i128())
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
        env.storage()
            .instance()
            .get(&DataKey::RewardTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Update the contract's branding metadata (admin only).
    pub fn update_contract_meta(
        env: Env,
        caller: Address,
        description: String,
        icon_url: String,
        website: String,
    ) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not found");
        assert!(caller == admin, "only admin can update contract metadata");

        let meta = ContractMetadata {
            description,
            icon_url,
            website,
        };
        env.storage().instance().set(&DataKey::ContractMeta, &meta);

        env.events().publish((symbol_short!("meta_upd"),), meta);
    }

    /// Return the current contract branding metadata.
    pub fn get_contract_meta(env: Env) -> ContractMetadata {
        env.storage()
            .instance()
            .get(&DataKey::ContractMeta)
            .expect("contract metadata not initialised")
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    fn _check_not_paused(env: &Env) {
        if Self::is_paused(env.clone()) {
            panic!("contract is paused");
        }
    }

    /// Asserts that the contract IS paused (for emergency operations only).
    fn _require_paused(env: &Env) {
        if !Self::is_paused(env.clone()) {
            panic!("contract not paused");
        }
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
            .get(&DataKey::UserRewardPerTokenPaid(
                user.clone(),
                reward_token.clone(),
            ))
            .unwrap_or(0);

        let stake = Self::_stake_of(env, user);
        // Keep the accrued value in scaled (fixed-point) form so that sub-stroop
        // fractional remainders are not truncated away on every update. Only the
        // final claim divides by PRECISION and stores the leftover remainder back,
        // which prevents reward tokens from being permanently locked up.
        let delta_rpt = rpt.checked_sub(user_rpt).unwrap_or(0);
        let delta = if delta_rpt > 0 && stake > 0 {
            let num = U256::from(stake as u128)
                .checked_mul(U256::from(delta_rpt as u128))
                .unwrap_or_else(|| panic!("rewards overflow"));
            if num > U256::from(i128::MAX as u128) {
                panic!("rewards overflow");
            }
            num.as_i128()
        } else {
            0
        };

        if delta > 0 {
            let prev: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Rewards(user.clone(), reward_token.clone()))
                .unwrap_or(0);
            env.storage().persistent().set(
                &DataKey::Rewards(user.clone(), reward_token.clone()),
                &prev.checked_add(delta).expect("rewards overflow"),
            );
        }

        // Snapshot current global rate for this user
        env.storage().persistent().set(
            &DataKey::UserRewardPerTokenPaid(user.clone(), reward_token.clone()),
            &rpt,
        );
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

        let contract_id = env.register(MultiTokenStaking, ());
        let client = MultiTokenStakingClient::new(&env, &contract_id);
        client.initialize(&admin, &stake_token_id.address());

        client.add_reward_token(&admin, &reward_token_1_id.address());
        client.add_reward_token(&admin, &reward_token_2_id.address());

        (
            env,
            contract_id,
            admin,
            alice,
            bob,
            reward_token_1_id.address(),
            reward_token_2_id.address(),
        )
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
    fn test_sub_stroop_remainder_accrual() {
        let (env, contract_id, admin, alice, bob, rwd1, _) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);
        let rwd1_client = TokenClient::new(&env, &rwd1);

        // Two equal stakers: total stake of 2, rewards of 1 stroop each deposit.
        // Each deposit accrues 0.5 stroop per user which truncates to 0 when naively
        // divided, so the remainder must be preserved across updates.
        client.stake(&alice, &1);
        client.stake(&bob, &1);

        client.deposit_rewards(&admin, &rwd1, &1);
        client.deposit_rewards(&admin, &rwd1, &1);

        // Each user should have accrued exactly 1 whole stroop after both deposits.
        assert_eq!(client.pending_rewards(&alice, &rwd1), 1);
        assert_eq!(client.pending_rewards(&bob, &rwd1), 1);

        client.claim(&alice, &rwd1);
        client.claim(&bob, &rwd1);

        assert_eq!(rwd1_client.balance(&alice), 1);
        assert_eq!(rwd1_client.balance(&bob), 1);

        // No rewards should remain locked in the contract for this token.
        assert_eq!(client.pending_rewards(&alice, &rwd1), 0);
        assert_eq!(client.pending_rewards(&bob, &rwd1), 0);
    }

    #[test]
    fn test_update_contract_meta() {
        let (env, contract_id, admin, _, _, _, _) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        let initial = client.get_contract_meta();
        assert_eq!(initial.description, String::from_str(&env, ""));
        assert_eq!(initial.icon_url, String::from_str(&env, ""));
        assert_eq!(initial.website, String::from_str(&env, ""));

        client.update_contract_meta(
            &admin,
            &String::from_str(&env, "Multi-token staking on Stellar"),
            &String::from_str(&env, "https://example.com/icon.png"),
            &String::from_str(&env, "https://example.com"),
        );

        let updated = client.get_contract_meta();
        assert_eq!(
            updated.description,
            String::from_str(&env, "Multi-token staking on Stellar")
        );
        assert_eq!(
            updated.icon_url,
            String::from_str(&env, "https://example.com/icon.png")
        );
        assert_eq!(
            updated.website,
            String::from_str(&env, "https://example.com")
        );
    }

    #[test]
    #[should_panic(expected = "only admin can update contract metadata")]
    fn test_update_contract_meta_non_admin() {
        let (env, contract_id, _, alice, _, _, _) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        client.update_contract_meta(
            &alice,
            &String::from_str(&env, "Hacked"),
            &String::from_str(&env, ""),
            &String::from_str(&env, ""),
        );
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

    // ── Comprehensive pause behavior tests (Issue #1001) ─────────────────

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_stake_blocked_when_paused() {
        let (env, contract_id, admin, alice, _bob, _rwd1, _rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);
        client.pause(&admin);
        client.stake(&alice, &100_000); // Must be blocked
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_claim_blocked_when_paused() {
        let (env, contract_id, admin, alice, _bob, rwd1, _rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);
        client.stake(&alice, &100_000);
        client.pause(&admin);
        client.claim(&alice, &rwd1); // Must be blocked
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_claim_all_blocked_when_paused() {
        let (env, contract_id, admin, alice, _bob, _rwd1, _rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);
        client.stake(&alice, &100_000);
        client.pause(&admin);
        client.claim_all(&alice); // Must be blocked
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_deposit_rewards_blocked_when_paused() {
        let (env, contract_id, admin, _alice, _bob, rwd1, _rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);
        client.pause(&admin);
        client.deposit_rewards(&admin, &rwd1, &1_000); // Must be blocked
    }

    #[test]
    fn test_pause_and_unpause_cycle() {
        let (env, contract_id, admin, alice, _bob, _rwd1, _rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        // Operations succeed before pause
        client.stake(&alice, &100_000);
        assert_eq!(client.stake_of(&alice), 100_000);

        // Pause the contract
        client.pause(&admin);
        assert!(client.is_paused());

        // Emergency withdraw works only when paused
        client.emergency_withdraw(&alice);
        assert_eq!(client.stake_of(&alice), 0);

        // Unpause restores normal operations
        client.unpause(&admin);
        assert!(!client.is_paused());

        // Normal staking works again after unpause
        client.stake(&alice, &50_000);
        assert_eq!(client.stake_of(&alice), 50_000);
    }

    #[test]
    fn test_emergency_withdraw_only_when_paused_full_flow() {
        let (env, contract_id, admin, alice, bob, _rwd1, _rwd2) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        // Both users stake
        client.stake(&alice, &300_000);
        client.stake(&bob, &200_000);

        // Admin pauses; emergency_withdraw works for both
        client.pause(&admin);

        client.emergency_withdraw(&alice);
        assert_eq!(client.stake_of(&alice), 0);
        assert_eq!(client.total_staked(), 200_000);

        client.emergency_withdraw(&bob);
        assert_eq!(client.stake_of(&bob), 0);
        assert_eq!(client.total_staked(), 0);
    }

    // ── Issue #1636: Safe fixed-point reward calculation unit tests ─────────

    #[test]
    fn test_standard_reward_calculation_regression() {
        let (env, contract_id, admin, alice, _bob, rwd1, _) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        client.stake(&alice, &500_000);
        client.deposit_rewards(&admin, &rwd1, &1_000);

        assert_eq!(client.pending_rewards(&alice, &rwd1), 1_000);
    }

    #[test]
    fn test_ten_year_lockup_overflow_immunity() {
        let (env, contract_id, _, _, _, _, _) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        // 10 years in seconds: 10 * 365 * 24 * 3600 = 315_360_000
        let ten_years = 315_360_000u64;
        let large_amount: i128 = 1_000_000_000_000_000_000; // 10^18
        let high_rate: i128 = 10_000_000; // 1 token/sec
        let rate_multiplier: i128 = 200; // 2x
        let emission_bps: i128 = 20_000; // 2x

        // With U256 intermediate math, this calculates accurately without panicking.
        let res = client.calculate_rewards(
            &large_amount,
            &high_rate,
            &ten_years,
            &rate_multiplier,
            &emission_bps,
        );

        let expected: i128 = 1_261_440_000_000_000_000_000_000_000;
        assert_eq!(res, expected);
    }

    #[test]
    fn test_boundary_breach_calculation_overflow() {
        let (env, contract_id, _, _, _, _, _) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        let ten_years = 315_360_000u64;
        let res = client.try_calculate_rewards(&i128::MAX, &i128::MAX, &ten_years, &200, &20_000);
        assert_eq!(res, Err(Ok(Error::CalculationOverflow)));
    }

    #[test]
    fn test_small_principal_short_duration_no_premature_truncation() {
        let (env, contract_id, _, _, _, _, _) = setup();
        let client = MultiTokenStakingClient::new(&env, &contract_id);

        let amount = 1_i128;
        let rate = 10_000_000_i128;
        let elapsed_seconds = 10_000u64;
        let rate_multiplier = 100_i128;
        let emission_bps = 10_000_i128;

        let res = client.calculate_rewards(
            &amount,
            &rate,
            &elapsed_seconds,
            &rate_multiplier,
            &emission_bps,
        );
        assert_eq!(res, 10_000);
    }
}
