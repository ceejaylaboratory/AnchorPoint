#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, vec, Address, Env, Vec};

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    BaseRate,   // Base rewards per second per token (scaled by 1e7)
    Tiers,      // Vec<LockTier>
    PenaltyBps,
    Stake(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LockTier {
    pub lock_seconds: u64,
    pub rate_multiplier: i128, // e.g. 100 = 1x, 150 = 1.5x, 200 = 2x (scaled by 100)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakeInfo {
    pub amount: i128,
    pub last_updated: u64,
    pub accumulated_rewards: i128,
    pub lock_end: u64,
    pub rate_multiplier: i128,
}

const REWARD_PRECISION: i128 = 10_000_000;

#[contract]
pub struct StakingContract;

#[contractimpl]
impl StakingContract {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        base_rate: i128,
        penalty_bps: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::BaseRate, &base_rate);
        env.storage().instance().set(&DataKey::PenaltyBps, &penalty_bps);

        // Default tiers: 1 month (1x), 3 months (1.25x), 6 months (1.5x), 12 months (2x)
        let default_tiers: Vec<LockTier> = vec![
            &env,
            LockTier { lock_seconds: 30 * 24 * 3600,  rate_multiplier: 100 },
            LockTier { lock_seconds: 90 * 24 * 3600,  rate_multiplier: 125 },
            LockTier { lock_seconds: 180 * 24 * 3600, rate_multiplier: 150 },
            LockTier { lock_seconds: 365 * 24 * 3600, rate_multiplier: 200 },
        ];
        env.storage().instance().set(&DataKey::Tiers, &default_tiers);
    }

    pub fn set_tiers(env: Env, tiers: Vec<LockTier>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        assert!(tiers.len() > 0, "need at least one tier");
        env.storage().instance().set(&DataKey::Tiers, &tiers);
    }

    pub fn get_tiers(env: Env) -> Vec<LockTier> {
        env.storage().instance().get(&DataKey::Tiers).unwrap()
    }

    pub fn stake(env: Env, user: Address, amount: i128, tier_index: u32) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let tiers: Vec<LockTier> = env.storage().instance().get(&DataKey::Tiers).unwrap();
        assert!((tier_index as u32) < tiers.len(), "invalid tier");
        let tier = tiers.get(tier_index).unwrap();

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        let mut info = Self::get_stake_info(env.clone(), user.clone());
        let current_time = env.ledger().timestamp();
        let base_rate: i128 = env.storage().instance().get(&DataKey::BaseRate).unwrap();

        info.accumulated_rewards += Self::calc_new_rewards(base_rate, &info, current_time);
        info.amount += amount;
        info.last_updated = current_time;
        // Always extend lock from now; take the furthest end date
        let new_lock_end = current_time + tier.lock_seconds;
        if new_lock_end > info.lock_end {
            info.lock_end = new_lock_end;
            info.rate_multiplier = tier.rate_multiplier;
        }

        env.storage().persistent().set(&DataKey::Stake(user.clone()), &info);
        env.events().publish((symbol_short!("stake"), user), (amount, info.lock_end, info.rate_multiplier));
    }

    pub fn withdraw(env: Env, user: Address) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        let info = Self::get_stake_info(env.clone(), user.clone());
        assert!(info.amount > 0, "nothing to withdraw");

        let current_time = env.ledger().timestamp();
        let base_rate: i128 = env.storage().instance().get(&DataKey::BaseRate).unwrap();
        let rewards = info.accumulated_rewards + Self::calc_new_rewards(base_rate, &info, current_time);
        let mut amount_to_return = info.amount;

        if current_time < info.lock_end {
            let penalty_bps: i128 = env.storage().instance().get(&DataKey::PenaltyBps).unwrap();
            let penalty = (amount_to_return * penalty_bps) / 10000;
            amount_to_return -= penalty;
        }

        let total_to_send = amount_to_return + rewards;

        env.storage().persistent().remove(&DataKey::Stake(user.clone()));

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &user, &total_to_send);

        env.events().publish((symbol_short!("withdraw"), user), (amount_to_return, rewards));
    }

    pub fn claim_rewards(env: Env, user: Address) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        let mut info = Self::get_stake_info(env.clone(), user.clone());
        let current_time = env.ledger().timestamp();
        let base_rate: i128 = env.storage().instance().get(&DataKey::BaseRate).unwrap();
        let rewards = info.accumulated_rewards + Self::calc_new_rewards(base_rate, &info, current_time);
        assert!(rewards > 0, "no rewards to claim");

        info.accumulated_rewards = 0;
        info.last_updated = current_time;
        env.storage().persistent().set(&DataKey::Stake(user.clone()), &info);

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &user, &rewards);

        env.events().publish((symbol_short!("claim"), user), rewards);
    }

    pub fn get_stake_info(env: Env, user: Address) -> StakeInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Stake(user))
            .unwrap_or(StakeInfo {
                amount: 0,
                last_updated: 0,
                accumulated_rewards: 0,
                lock_end: 0,
                rate_multiplier: 100,
            })
    }

    pub fn pending_rewards(env: Env, user: Address) -> i128 {
        let info = Self::get_stake_info(env.clone(), user);
        let base_rate: i128 = env.storage().instance().get(&DataKey::BaseRate).unwrap();
        let current_time = env.ledger().timestamp();
        info.accumulated_rewards + Self::calc_new_rewards(base_rate, &info, current_time)
    }

    fn calc_new_rewards(base_rate: i128, info: &StakeInfo, current_time: u64) -> i128 {
        if info.amount == 0 || info.last_updated == 0 || current_time <= info.last_updated {
            return 0;
        }
        let seconds = (current_time - info.last_updated) as i128;
        // rate_multiplier: 100 = 1x, 150 = 1.5x, 200 = 2x
        (info.amount * base_rate * seconds * info.rate_multiplier) / (REWARD_PRECISION * 100)
    }
}
