#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    RewardRate, // Rewards per second per token (scaled by 1e7)
    LockPeriod, // Seconds
    PenaltyBps, // Penalty percentage (10000 = 100%)
    Stake(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakeInfo {
    pub amount: i128,
    pub last_updated: u64,
    pub accumulated_rewards: i128,
    pub lock_end: u64,
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
        reward_rate: i128,
        lock_period: u64,
        penalty_bps: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::RewardRate, &reward_rate);
        env.storage()
            .instance()
            .set(&DataKey::LockPeriod, &lock_period);
        env.storage()
            .instance()
            .set(&DataKey::PenaltyBps, &penalty_bps);
    }

    pub fn stake(env: Env, user: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        let mut info = Self::get_stake_info(env.clone(), user.clone());
        let current_time = env.ledger().timestamp();

        // Update rewards
        info.accumulated_rewards += Self::calc_new_rewards(env.clone(), &info, current_time);
        info.amount += amount;
        info.last_updated = current_time;
        info.lock_end = current_time
            + env
                .storage()
                .instance()
                .get::<_, u64>(&DataKey::LockPeriod)
                .unwrap();

        env.storage()
            .persistent()
            .set(&DataKey::Stake(user.clone()), &info);
        // Topic: event name only; user + amounts in data.
        env.events()
            .publish(symbol_short!("stake"), (user, amount, info.lock_end));
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
        let rewards =
            info.accumulated_rewards + Self::calc_new_rewards(env.clone(), &info, current_time);
        let mut amount_to_return = info.amount;

        // Apply penalty if before lock_end
        if current_time < info.lock_end {
            let penalty_bps: i128 = env.storage().instance().get(&DataKey::PenaltyBps).unwrap();
            let penalty = (amount_to_return * penalty_bps) / 10000;
            amount_to_return -= penalty;
            // Penalties stay in contract as "unclaimed rewards" or similar
            // Or just lost.
        }

        let total_to_send = amount_to_return + rewards;

        // Reset stake info
        env.storage()
            .persistent()
            .remove(&DataKey::Stake(user.clone()));

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &user, &total_to_send);

        // Topic: event name only; user + amounts in data.
        env.events().publish(
            symbol_short!("withdraw"),
            (user, amount_to_return, rewards),
        );
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
        let rewards =
            info.accumulated_rewards + Self::calc_new_rewards(env.clone(), &info, current_time);
        assert!(rewards > 0, "no rewards to claim");

        info.accumulated_rewards = 0;
        info.last_updated = current_time;
        env.storage()
            .persistent()
            .set(&DataKey::Stake(user.clone()), &info);

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &user, &rewards);

        // Topic: event name only; user + rewards in data.
        env.events()
            .publish(symbol_short!("claim"), (user, rewards));
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
            })
    }

    fn calc_new_rewards(env: Env, info: &StakeInfo, current_time: u64) -> i128 {
        if info.amount == 0 || info.last_updated == 0 || current_time <= info.last_updated {
            return 0;
        }
        let rate: i128 = env.storage().instance().get(&DataKey::RewardRate).unwrap();
        let seconds = (current_time - info.last_updated) as i128;
        (info.amount * rate * seconds) / REWARD_PRECISION
    }
}
