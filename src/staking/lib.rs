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
        env.events()
            .publish((symbol_short!("stake"), user), (amount, info.lock_end));
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

        env.events().publish(
            (symbol_short!("withdraw"), user),
            (amount_to_return, rewards),
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

        env.events()
            .publish((symbol_short!("claim"), user), rewards);
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

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger}, Env, Address, symbol_short};

    #[contract]
    pub struct MockRegistry;
    #[contractimpl]
    impl MockRegistry {
        pub fn is_paused(env: Env) -> bool {
            env.storage().instance().get(&symbol_short!("paused")).unwrap_or(false)
        }
        pub fn set_paused(env: Env, paused: bool) {
            env.storage().instance().set(&symbol_short!("paused"), &paused);
        }
    }

    fn setup() -> (Env, StakingContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(StakingContract, ());
        let client = StakingContractClient::new(&env, &id);
        
        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract(token_admin);
        
        client.initialize(&admin, &token_id, &1000, &3600, &1000); // 10% penalty, 1hr lock
        (env, client, admin, token_id)
    }

    #[test]
    fn test_initialize() {
        let (env, client, _admin, token_id) = setup();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.initialize(&Address::generate(&env), &token_id, &1000, &3600, &1000);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_stake() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        
        let token_client = token::Client::new(&env, &token_id);
        token_client.mint(&user, &10000);
        
        client.stake(&user, &1000);
        
        let info = client.get_stake_info(&user);
        assert_eq!(info.amount, 1000);
        assert_eq!(info.accumulated_rewards, 0);
        assert_eq!(info.lock_end, env.ledger().timestamp() + 3600);
        
        assert_eq!(token_client.balance(&user), 9000);
        assert_eq!(token_client.balance(&client.address), 1000);
    }

    #[test]
    fn test_withdraw_with_penalty() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let token_client = token::Client::new(&env, &token_id);
        token_client.mint(&user, &10000);
        
        client.stake(&user, &1000);
        
        // Withdraw immediately (before lock_end)
        client.withdraw(&user);
        
        // 10% penalty on 1000 = 100. Should get 900 back.
        assert_eq!(token_client.balance(&user), 9900);
        let info = client.get_stake_info(&user);
        assert_eq!(info.amount, 0);
    }

    #[test]
    fn test_withdraw_no_penalty() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let token_client = token::Client::new(&env, &token_id);
        token_client.mint(&user, &10000);
        
        client.stake(&user, &1000);
        
        // Advance time 4000s (> 3600s lock)
        env.ledger().set_timestamp(env.ledger().timestamp() + 4000);
        
        client.withdraw(&user);
        
        // rewards = (1000 * 1000 * 4000) / 10,000,000 = 400
        assert_eq!(token_client.balance(&user), 9000 + 1000 + 400);
    }

    #[test]
    fn test_claim_rewards() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let token_client = token::Client::new(&env, &token_id);
        token_client.mint(&user, &10000);
        
        client.stake(&user, &1000);
        
        env.ledger().set_timestamp(env.ledger().timestamp() + 1000);
        
        client.claim_rewards(&user);
        
        // rewards = 100
        assert_eq!(token_client.balance(&user), 9000 + 100);
        
        let info = client.get_stake_info(&user);
        assert_eq!(info.amount, 1000);
        assert_eq!(info.accumulated_rewards, 0);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_pause_functionality() {
        let (env, client, _admin, _token_id) = setup();
        let user = Address::generate(&env);
        
        let registry_id = env.register(MockRegistry, ());
        let registry_client = MockRegistryClient::new(&env, &registry_id);
        registry_client.set_paused(&true);
        
        client.set_security_registry(&registry_id);
        
        client.stake(&user, &100);
    }

    #[test]
    #[should_panic(expected = "already set")]
    fn test_set_registry_twice_panics() {
        let (env, client, _admin, _token_id) = setup();
        let registry_id = env.register(MockRegistry, ());
        client.set_security_registry(&registry_id);
        client.set_security_registry(&registry_id);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_stake_zero_panics() {
        let (env, client, _admin, _token_id) = setup();
        let user = Address::generate(&env);
        client.stake(&user, &0);
    }

    #[test]
    #[should_panic(expected = "nothing to withdraw")]
    fn test_withdraw_nothing_panics() {
        let (env, client, _admin, _token_id) = setup();
        let user = Address::generate(&env);
        client.withdraw(&user);
    }

    #[test]
    #[should_panic(expected = "no rewards to claim")]
    fn test_claim_no_rewards_panics() {
        let (env, client, _admin, _token_id) = setup();
        let user = Address::generate(&env);
        client.stake(&user, &1000);
        client.claim_rewards(&user);
    }
}

