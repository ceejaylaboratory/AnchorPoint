#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, vec, Address, Env, Vec,
};

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    BaseRate, // Base rewards per second per token (scaled by 1e7)
    Tiers,    // Vec<LockTier>
    PenaltyBps,
    PenaltyPool, // Address to receive emergency withdrawal penalties
    Stake(Address),
    // Appended after the original variants so that storage encodings of the
    // keys above stay valid for already-deployed instances.
    TotalStaked,    // Total tokens staked across every user
    EmissionParams, // EmissionParams, dynamic APR scaling configuration
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

/// Dynamic emission (APR) scaling parameters.
///
/// The pool emits `base_rate` per second per staked token at 1x. Emissions are
/// then scaled *inversely* against how full the pool is, so a thin pool pays out
/// more per token (no dilution) and a saturated pool pays out less (no runaway
/// emission).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmissionParams {
    /// Staked volume the pool is designed to hold. At this level emissions run
    /// at exactly 1x.
    pub target_capacity: i128,
    /// Lower threshold for the scaling multiplier, in bps (10_000 = 1x).
    pub min_multiplier_bps: i128,
    /// Upper threshold for the scaling multiplier, in bps (10_000 = 1x).
    pub max_multiplier_bps: i128,
}

const REWARD_PRECISION: i128 = 10_000_000;
const BPS: i128 = 10_000;
const SECONDS_PER_YEAR: u64 = 365 * 24 * 3600;

/// Default capacity: 100_000 tokens at 7 decimals.
const DEFAULT_TARGET_CAPACITY: i128 = 1_000_000_000_000;
/// Reached once the pool holds >= 2x `target_capacity`.
const DEFAULT_MIN_MULTIPLIER_BPS: i128 = 2_500; // 0.25x
/// Reached while the pool is empty.
const DEFAULT_MAX_MULTIPLIER_BPS: i128 = 20_000; // 2.00x

#[contract]
pub struct StakingContract;

#[allow(deprecated)]
#[contractimpl]
impl StakingContract {
    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env
            .storage()
            .instance()
            .has(&soroban_sdk::symbol_short!("sec_reg"))
        {
            panic!("already set");
        }
        env.storage()
            .instance()
            .set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
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
        env.storage()
            .instance()
            .set(&DataKey::PenaltyBps, &penalty_bps);
        env.storage().instance().set(&DataKey::TotalStaked, &0_i128);
        env.storage()
            .instance()
            .set(&DataKey::EmissionParams, &default_emission_params());

        // Default tiers: 1 month (1x), 3 months (1.25x), 6 months (1.5x), 12 months (2x)
        let default_tiers: Vec<LockTier> = vec![
            &env,
            LockTier {
                lock_seconds: 30 * 24 * 3600,
                rate_multiplier: 100,
            },
            LockTier {
                lock_seconds: 90 * 24 * 3600,
                rate_multiplier: 125,
            },
            LockTier {
                lock_seconds: 180 * 24 * 3600,
                rate_multiplier: 150,
            },
            LockTier {
                lock_seconds: 365 * 24 * 3600,
                rate_multiplier: 200,
            },
        ];
        env.storage()
            .instance()
            .set(&DataKey::Tiers, &default_tiers);
    }

    pub fn set_tiers(env: Env, tiers: Vec<LockTier>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        assert!(!tiers.is_empty(), "need at least one tier");
        env.storage().instance().set(&DataKey::Tiers, &tiers);
    }

    pub fn get_tiers(env: Env) -> Vec<LockTier> {
        env.storage().instance().get(&DataKey::Tiers).unwrap()
    }

<<<<<<< Updated upstream
    /// Admin-tunable dynamic APR scaling configuration.
    pub fn set_emission_params(env: Env, params: EmissionParams) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        assert!(
            params.target_capacity >= 0,
            "target capacity must be positive"
        );
        assert!(
            params.min_multiplier_bps >= 0,
            "min multiplier must be positive"
        );
        assert!(
            params.max_multiplier_bps >= params.min_multiplier_bps,
            "max multiplier below min"
        );
        env.storage()
            .instance()
            .set(&DataKey::EmissionParams, &params);
    }

    /// Falls back to the defaults so instances deployed before dynamic scaling
    /// was introduced keep working after an upgrade.
    pub fn emission_params(env: Env) -> EmissionParams {
        env.storage()
            .instance()
            .get(&DataKey::EmissionParams)
            .unwrap_or_else(default_emission_params)
    }

    /// Total tokens currently staked, i.e. the utilisation numerator.
    pub fn total_staked(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0_i128)
    }

    /// Scaling multiplier currently applied to emissions, in bps (10_000 = 1x).
    pub fn current_emission_multiplier_bps(env: Env) -> i128 {
        let params = Self::emission_params(env.clone());
        let total_staked = Self::total_staked(env);
        Self::emission_multiplier_bps(&params, total_staked)
    }

    /// Annualised emission rate for a staked token, in bps. Moves inversely
    /// with pool utilisation.
    pub fn emission_apr_bps(env: Env) -> i128 {
        let base_rate: i128 = env
            .storage()
            .instance()
            .get(&DataKey::BaseRate)
            .unwrap_or(0);
        let emission_bps = Self::current_emission_multiplier_bps(env);
        base_rate
            .checked_mul(SECONDS_PER_YEAR as i128)
            .expect("apr overflow")
            .checked_mul(emission_bps)
            .expect("apr overflow")
            / (REWARD_PRECISION * BPS)
=======
    pub fn set_penalty_pool(env: Env, penalty_pool: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PenaltyPool, &penalty_pool);
>>>>>>> Stashed changes
    }

    pub fn stake(env: Env, user: Address, amount: i128, tier_index: u32) {
        if let Some(registry) = env
            .storage()
            .instance()
            .get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg"))
        {
            let is_paused: bool = env.invoke_contract(
                &registry,
                &soroban_sdk::Symbol::new(&env, "is_paused"),
                soroban_sdk::vec![&env],
            );
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let tiers: Vec<LockTier> = env.storage().instance().get(&DataKey::Tiers).unwrap();
        assert!(tier_index < tiers.len(), "invalid tier");
        let tier = tiers.get(tier_index).unwrap();

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&user, env.current_contract_address(), &amount);

        let mut info = Self::get_stake_info(env.clone(), user.clone());
        let current_time = env.ledger().timestamp();

        // Accrue on the pre-deposit pool size, then grow the pool.
        info.accumulated_rewards = info
            .accumulated_rewards
            .checked_add(Self::accrued_rewards(&env, &info, current_time))
            .expect("rewards overflow");
        info.amount = info.amount.checked_add(amount).expect("stake overflow");
        info.last_updated = current_time;
        // Always extend lock from now; take the furthest end date and keep the
        // multiplier in sync with it.
        let new_lock_end = current_time
            .checked_add(tier.lock_seconds)
            .expect("lock end overflow");
        if new_lock_end > info.lock_end {
            info.lock_end = new_lock_end;
            info.rate_multiplier = tier.rate_multiplier;
        }

        let total_staked = Self::total_staked(env.clone())
            .checked_add(amount)
            .expect("total staked overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &total_staked);

        env.storage()
            .persistent()
            .set(&DataKey::Stake(user.clone()), &info);
        env.events().publish(
            (symbol_short!("stake"), user),
            (
                amount,
                info.lock_end,
                Self::current_emission_multiplier_bps(env),
            ),
            (symbol_short!("staking"), symbol_short!("stake")),
            (user, amount, info.lock_end, info.rate_multiplier),
        );
    }

    pub fn withdraw(env: Env, user: Address) {
        if let Some(registry) = env
            .storage()
            .instance()
            .get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg"))
        {
            let is_paused: bool = env.invoke_contract(
                &registry,
                &soroban_sdk::Symbol::new(&env, "is_paused"),
                soroban_sdk::vec![&env],
            );
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        let info = Self::get_stake_info(env.clone(), user.clone());
        assert!(info.amount > 0, "nothing to withdraw");

        let current_time = env.ledger().timestamp();
        let rewards = info
            .accumulated_rewards
            .checked_add(Self::accrued_rewards(&env, &info, current_time))
            .expect("rewards overflow");
        let base_rate: i128 = env.storage().instance().get(&DataKey::BaseRate).unwrap();
        let rewards =
            info.accumulated_rewards + Self::calc_new_rewards(base_rate, &info, current_time);
        let mut amount_to_return = info.amount;

        if current_time < info.lock_end {
            let penalty_bps: i128 = env.storage().instance().get(&DataKey::PenaltyBps).unwrap();
            let penalty = amount_to_return
                .checked_mul(penalty_bps)
                .expect("penalty overflow")
                / 10_000;
            amount_to_return = amount_to_return
                .checked_sub(penalty)
                .expect("penalty underflow");
            let penalty = (amount_to_return * penalty_bps) / 10000;
            amount_to_return -= penalty;
            // Penalties stay in contract as "unclaimed rewards" or similar
            // Or just lost.
        }

        let total_to_send = amount_to_return
            .checked_add(rewards)
            .expect("total overflow");

        env.storage()
            .persistent()
            .remove(&DataKey::Stake(user.clone()));
        let total_staked = Self::total_staked(env.clone())
            .checked_sub(info.amount)
            .expect("total staked underflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &total_staked);

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &user, &total_to_send);

        env.events().publish(
            (symbol_short!("withdraw"), user),
            (amount_to_return, rewards),
            (symbol_short!("staking"), symbol_short!("withdraw")),
            (user, amount_to_return, rewards),
        );
    }

    pub fn claim_rewards(env: Env, user: Address) {
        if let Some(registry) = env
            .storage()
            .instance()
            .get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg"))
        {
            let is_paused: bool = env.invoke_contract(
                &registry,
                &soroban_sdk::Symbol::new(&env, "is_paused"),
                soroban_sdk::vec![&env],
            );
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        let mut info = Self::get_stake_info(env.clone(), user.clone());
        let current_time = env.ledger().timestamp();
        let rewards = info
            .accumulated_rewards
            .checked_add(Self::accrued_rewards(&env, &info, current_time))
            .expect("rewards overflow");
        let base_rate: i128 = env.storage().instance().get(&DataKey::BaseRate).unwrap();
        let rewards =
            info.accumulated_rewards + Self::calc_new_rewards(base_rate, &info, current_time);
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
        env.events().publish(
            (symbol_short!("staking"), symbol_short!("claim")),
            (user, rewards),
        );
    }

    pub fn emergency_withdraw(env: Env, user: Address) -> i128 {
        user.require_auth();
        let info = Self::get_stake_info(env.clone(), user.clone());
        assert!(info.amount > 0, "nothing to withdraw");

        let penalty_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::PenaltyPool)
            .expect("penalty pool not set");

        // Calculate 10% penalty on principal
        let penalty = (info.amount * 1000) / 10000; // 10% = 1000 bps
        let amount_to_user = info.amount - penalty;

        // Forfeit all accrued rewards (do not pay them out)
        // Rewards are simply lost

        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);

        // Transfer 90% to user
        token_client.transfer(&env.current_contract_address(), &user, &amount_to_user);

        // Transfer 10% penalty to penalty pool
        token_client.transfer(&env.current_contract_address(), &penalty_pool, &penalty);

        // Reset user stake balance
        env.storage()
            .persistent()
            .remove(&DataKey::Stake(user.clone()));

        env.events().publish(
            (symbol_short!("staking"), symbol_short!("emergency")),
            (user, amount_to_user, penalty),
        );

        amount_to_user
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
        let info = Self::get_stake_info(env.clone(), user.clone());
        let current_time = env.ledger().timestamp();
        info.accumulated_rewards
            .checked_add(Self::accrued_rewards(&env, &info, current_time))
            .expect("rewards overflow")
    }

    /// Rewards accrued by `info` since its last update, with the dynamic
    /// emission multiplier folded in.
    fn accrued_rewards(env: &Env, info: &StakeInfo, current_time: u64) -> i128 {
        let base_rate: i128 = env
            .storage()
            .instance()
            .get(&DataKey::BaseRate)
            .unwrap_or(0);
        let params = Self::emission_params(env.clone());
        let total_staked = Self::total_staked(env.clone());
        Self::calc_new_rewards(
            base_rate,
            Self::emission_multiplier_bps(&params, total_staked),
            info,
            current_time,
        )
    }

    /// Pure inverse scaling curve, in bps (10_000 = 1x).
    ///
    /// * empty pool (0% utilisation)      -> `max_multiplier_bps` (2x)
    /// * at `target_capacity` (100%)      -> 1x
    /// * at 2x `target_capacity` (200%)   -> `min_multiplier_bps` (0.25x)
    /// * beyond that                       -> clamped to the minimum
    fn emission_multiplier_bps(params: &EmissionParams, total_staked: i128) -> i128 {
        if params.target_capacity <= 0 {
            return BPS;
        }
        let utilisation_bps = total_staked
            .max(0)
            .checked_mul(BPS)
            .expect("utilisation overflow")
            / params.target_capacity;
        let raw_bps = (2 * BPS) - utilisation_bps;
        let floor = params.min_multiplier_bps.max(0);
        let ceiling = params.max_multiplier_bps.max(floor);
        raw_bps.max(floor).min(ceiling)
    }

    fn calc_new_rewards(
        base_rate: i128,
        emission_bps: i128,
        info: &StakeInfo,
        current_time: u64,
    ) -> i128 {
        if info.amount == 0 || info.last_updated == 0 || current_time <= info.last_updated {
            return 0;
        }
        let seconds = (current_time - info.last_updated) as i128;
        // rate_multiplier: 100 = 1x, 150 = 1.5x, 200 = 2x
        // emission_bps: 10_000 = 1x, dynamic and inversely tied to pool usage
        info.amount
            .checked_mul(base_rate)
            .expect("reward overflow")
            .checked_mul(seconds)
            .expect("reward overflow")
            .checked_mul(info.rate_multiplier)
            .expect("reward overflow")
            .checked_mul(emission_bps)
            .expect("reward overflow")
            / (REWARD_PRECISION * 100 * BPS)
    }
}

fn default_emission_params() -> EmissionParams {
    EmissionParams {
        target_capacity: DEFAULT_TARGET_CAPACITY,
        min_multiplier_bps: DEFAULT_MIN_MULTIPLIER_BPS,
        max_multiplier_bps: DEFAULT_MAX_MULTIPLIER_BPS,
        (info.amount * base_rate * seconds * info.rate_multiplier) / (REWARD_PRECISION * 100)
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        token::{self, StellarAssetClient},
        Address, Env,
    };

    #[contract]
    pub struct MockRegistry;
    #[contractimpl]
    impl MockRegistry {
        pub fn is_paused(env: Env) -> bool {
            env.storage()
                .instance()
                .get(&symbol_short!("paused"))
                .unwrap_or(false)
        }
        pub fn set_paused(env: Env, paused: bool) {
            env.storage()
                .instance()
                .set(&symbol_short!("paused"), &paused);
        }
    }

    const START_TIME: u64 = 1_700_000_000;
    const BASE_RATE: i128 = 1_000;
    const CAPACITY: i128 = 100_000_000; // 10_000 tokens at 7 decimals
    fn setup() -> (Env, StakingContractClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(START_TIME);
        env.ledger().set_timestamp(12345);
        let id = env.register(StakingContract, ());
        let client = StakingContractClient::new(&env, &id);

        let admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(token_admin)
            .address();

        client.initialize(&admin, &token_id, &BASE_RATE, &1000); // 10% early penalty

        // Make the capacity thresholds small enough to drive the pool through
        // the low / medium / high bands in a unit test.
        client.set_emission_params(&EmissionParams {
            target_capacity: CAPACITY,
            min_multiplier_bps: DEFAULT_MIN_MULTIPLIER_BPS,
            max_multiplier_bps: DEFAULT_MAX_MULTIPLIER_BPS,
        });
        client.initialize(&admin, &token_id, &1000, &1000); // 10% penalty, 1hr lock

        // Define tiers matching the test expectations!
        let test_tiers = vec![
            &env,
            LockTier {
                lock_seconds: 3600,
                rate_multiplier: 100,
            },
        ];
        client.set_tiers(&test_tiers);

        (env, client, admin, token_id)
    }

    fn mint(env: &Env, token_id: &Address, user: &Address, amount: i128) {
        StellarAssetClient::new(env, token_id).mint(user, &amount);
    }

    /// Seeds the staking contract with the reward inventory it pays out.
    fn fund_rewards(env: &Env, client: &StakingContractClient, token_id: &Address, amount: i128) {
        mint(env, token_id, &client.address, amount);
    }

    /// Reward for `amount` staked over `seconds` at `emission_bps`, mirroring
    /// `calc_new_rewards` at a 1x lock tier.
    fn expected_rewards(amount: i128, seconds: i128, emission_bps: i128) -> i128 {
        amount * BASE_RATE * seconds * 100 * emission_bps / (10_000_000 * 100 * 10_000)
    }

    fn params(capacity: i128, min_bps: i128, max_bps: i128) -> EmissionParams {
        EmissionParams {
            target_capacity: capacity,
            min_multiplier_bps: min_bps,
            max_multiplier_bps: max_bps,
        }
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_initialize_twice_panics() {
        let (env, client, _admin, token_id) = setup();
        let other = Address::generate(&env);
        client.initialize(&other, &token_id, &BASE_RATE, &1000);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.initialize(&Address::generate(&env), &token_id, &1000, &1000);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_stake() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let token_client = TokenClient::new(&env, &token_id);
        mint(&env, &token_id, &user, 10_000);

        client.stake(&user, &1_000, &0);

        let token_client = token::Client::new(&env, &token_id);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.stake(&user, &1000, &0);

        let info = client.get_stake_info(&user);
        assert_eq!(info.amount, 1_000);
        assert_eq!(info.accumulated_rewards, 0);
        assert_eq!(info.rate_multiplier, 100);
        assert_eq!(info.lock_end, START_TIME + 30 * 24 * 3600);
        assert_eq!(client.total_staked(), 1_000);

        assert_eq!(token_client.balance(&user), 9_000);
        assert_eq!(token_client.balance(&client.address), 1_000);
        assert_eq!(info.lock_end, env.ledger().timestamp() + 3600);

        assert_eq!(token_client.balance(&user), 9000);
        assert_eq!(token_client.balance(&client.address), 1000);
    }

    #[test]
    fn test_withdraw_with_penalty() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let token_client = TokenClient::new(&env, &token_id);
        mint(&env, &token_id, &user, 10_000);

        client.stake(&user, &1_000, &0);
        // Withdraw immediately (before lock_end): 10% penalty on 1000 = 100.
        client.withdraw(&user);

        assert_eq!(token_client.balance(&user), 9_900);
        assert_eq!(client.get_stake_info(&user).amount, 0);
        assert_eq!(client.total_staked(), 0);
        let token_client = token::Client::new(&env, &token_id);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.stake(&user, &1000, &0);

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
        let token_client = TokenClient::new(&env, &token_id);
        mint(&env, &token_id, &user, 10_000);
        fund_rewards(&env, &client, &token_id, 1_000_000);

        client.stake(&user, &1_000, &0);
        env.ledger().set_timestamp(START_TIME + 40 * 24 * 3600); // past the lock

        client.withdraw(&user);

        // Pool is effectively empty -> emissions at the 2x max threshold.
        let seconds = (40 * 24 * 3600) as i128;
        let rewards = expected_rewards(1_000, seconds, 20_000);
        assert_eq!(rewards, 691_200);
        assert_eq!(token_client.balance(&user), 9_000 + 1_000 + rewards);
        assert_eq!(client.total_staked(), 0);
        let token_client = token::Client::new(&env, &token_id);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.stake(&user, &1000, &0);

        // Advance time 4000s (> 3600s lock)
        env.ledger().set_timestamp(env.ledger().timestamp() + 4000);

        // Fund contract with extra reward tokens so it can pay out rewards
        stellar_asset_client.mint(&client.address, &400);

        client.withdraw(&user);

        // rewards = (1000 * 1000 * 4000) / 10,000,000 = 400
        assert_eq!(token_client.balance(&user), 9000 + 1000 + 400);
    }

    #[test]
    fn test_claim_rewards() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let token_client = TokenClient::new(&env, &token_id);
        mint(&env, &token_id, &user, 20_000_000);
        fund_rewards(&env, &client, &token_id, 5_000_000);

        // 10% utilised -> 1.9x emissions.
        client.stake(&user, &10_000_000, &0);
        env.ledger().set_timestamp(START_TIME + 1_000);

        let rewards = expected_rewards(10_000_000, 1_000, 19_000);
        assert_eq!(rewards, 1_900_000);
        assert_eq!(client.pending_rewards(&user), rewards);

        client.claim_rewards(&user);
        assert_eq!(token_client.balance(&user), 10_000_000 + rewards);
        let token_client = token::Client::new(&env, &token_id);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.stake(&user, &1000, &0);

        env.ledger().set_timestamp(env.ledger().timestamp() + 1000);

        client.claim_rewards(&user);

        // rewards = 100
        assert_eq!(token_client.balance(&user), 9000 + 100);

        let info = client.get_stake_info(&user);
        assert_eq!(info.amount, 10_000_000);
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

        client.stake(&user, &100, &0);
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
        client.stake(&user, &0, &0);
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
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        mint(&env, &token_id, &user, 1_000);
        client.stake(&user, &1_000, &0);
        client.claim_rewards(&user);
    }

    // ---- dynamic APR scaling -------------------------------------------------

    #[test]
    fn test_scaling_curve_thresholds() {
        let p = params(
            CAPACITY,
            DEFAULT_MIN_MULTIPLIER_BPS,
            DEFAULT_MAX_MULTIPLIER_BPS,
        );

        // Empty pool: max threshold.
        assert_eq!(StakingContract::emission_multiplier_bps(&p, 0), 20_000);
        // Low usage (10%): still well above 1x.
        assert_eq!(
            StakingContract::emission_multiplier_bps(&p, CAPACITY / 10),
            19_000
        );
        // Medium usage (50%): 1.5x.
        assert_eq!(
            StakingContract::emission_multiplier_bps(&p, CAPACITY / 2),
            15_000
        );
        // At target capacity: exactly 1x.
        assert_eq!(
            StakingContract::emission_multiplier_bps(&p, CAPACITY),
            10_000
        );
        // High usage (150%): 0.5x.
        assert_eq!(
            StakingContract::emission_multiplier_bps(&p, CAPACITY * 3 / 2),
            5_000
        );
        // Saturated (200%): clamped at the minimum threshold.
        assert_eq!(
            StakingContract::emission_multiplier_bps(&p, CAPACITY * 2),
            DEFAULT_MIN_MULTIPLIER_BPS
        );
        // Beyond saturation: still clamped.
        assert_eq!(
            StakingContract::emission_multiplier_bps(&p, CAPACITY * 10),
            DEFAULT_MIN_MULTIPLIER_BPS
        );
    }

    #[test]
    fn test_scaling_curve_without_capacity_is_flat() {
        let p = params(0, DEFAULT_MIN_MULTIPLIER_BPS, DEFAULT_MAX_MULTIPLIER_BPS);
        assert_eq!(StakingContract::emission_multiplier_bps(&p, 0), 10_000);
        assert_eq!(
            StakingContract::emission_multiplier_bps(&p, CAPACITY * 100),
            10_000
        );
    }

    #[test]
    fn test_multiplier_by_pool_usage() {
        // Low usage (10% of capacity): emissions boosted to 1.9x.
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        mint(&env, &token_id, &user, 20_000_000);
        client.stake(&user, &(CAPACITY / 10), &0);
        assert_eq!(client.total_staked(), CAPACITY / 10);
        assert_eq!(client.current_emission_multiplier_bps(), 19_000);
        assert_eq!(client.emission_apr_bps(), 5_991);

        // Medium usage (60% of capacity): emissions ease off to 1.4x.
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        mint(&env, &token_id, &user, 20_000_000);
        client.stake(&user, &(CAPACITY / 10), &0);
        let filler = Address::generate(&env);
        mint(&env, &token_id, &filler, 60_000_000);
        client.stake(&filler, &(CAPACITY / 2), &0);
        assert_eq!(client.total_staked(), CAPACITY * 6 / 10);
        assert_eq!(client.current_emission_multiplier_bps(), 14_000);
        assert_eq!(client.emission_apr_bps(), 4_415);

        // At capacity (100%): emissions normalise to exactly 1x.
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        mint(&env, &token_id, &user, 20_000_000);
        client.stake(&user, &(CAPACITY / 10), &0);
        let filler = Address::generate(&env);
        mint(&env, &token_id, &filler, 200_000_000);
        client.stake(&filler, &(CAPACITY - CAPACITY / 10), &0);
        assert_eq!(client.total_staked(), CAPACITY);
        assert_eq!(client.current_emission_multiplier_bps(), 10_000);
        assert_eq!(client.emission_apr_bps(), 3_153);

        // High usage (>= 200%): emissions damped to the 0.25x floor.
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        mint(&env, &token_id, &user, 20_000_000);
        client.stake(&user, &(CAPACITY / 10), &0);
        let whale = Address::generate(&env);
        mint(&env, &token_id, &whale, 300_000_000);
        client.stake(&whale, &(CAPACITY * 2), &0);
        assert_eq!(client.total_staked(), CAPACITY * 2 + CAPACITY / 10);
        assert_eq!(
            client.current_emission_multiplier_bps(),
            DEFAULT_MIN_MULTIPLIER_BPS
        );
        assert_eq!(client.emission_apr_bps(), 788);
    }

    #[test]
    fn test_rewards_scale_inversely_with_usage() {
        let elapsed = 1_000_i128;
        let stake = CAPACITY / 10; // 10% of capacity on its own

        // Low usage: this stake alone is 10% of capacity -> 1.9x emissions.
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        mint(&env, &token_id, &user, 20_000_000);
        client.stake(&user, &stake, &0);
        env.ledger().set_timestamp(START_TIME + elapsed as u64);
        let thin_pool = client.pending_rewards(&user);
        assert_eq!(thin_pool, expected_rewards(stake, elapsed, 19_000));
        assert_eq!(thin_pool, 1_900_000);

        // High usage: identical stake and window, but the pool is saturated.
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        mint(&env, &token_id, &user, 20_000_000);
        let whale = Address::generate(&env);
        mint(&env, &token_id, &whale, 300_000_000);
        client.stake(&whale, &(CAPACITY * 2), &0);
        client.stake(&user, &stake, &0);
        env.ledger().set_timestamp(START_TIME + elapsed as u64);
        let saturated_pool = client.pending_rewards(&user);
        assert_eq!(
            saturated_pool,
            expected_rewards(stake, elapsed, DEFAULT_MIN_MULTIPLIER_BPS)
        );
        assert_eq!(saturated_pool, 250_000);

        // Dilution guard: the same stake is worth strictly less once saturated.
        assert!(saturated_pool < thin_pool);
    }

    #[test]
    fn test_total_staked_tracks_positions() {
        let (env, client, _admin, token_id) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        mint(&env, &token_id, &a, 10_000);
        mint(&env, &token_id, &b, 10_000);

        client.stake(&a, &4_000, &0);
        assert_eq!(client.total_staked(), 4_000);

        client.stake(&b, &1_500, &1);
        assert_eq!(client.total_staked(), 5_500);

        // A top-up does not double count.
        client.stake(&a, &500, &0);
        assert_eq!(client.total_staked(), 6_000);

        client.withdraw(&a);
        assert_eq!(client.total_staked(), 1_500);

        client.withdraw(&b);
        assert_eq!(client.total_staked(), 0);
    }

    #[test]
    fn test_emission_params_roundtrip_and_defaults() {
        let (env, client, _admin, token_id) = setup();
        assert_eq!(client.emission_params(), params(CAPACITY, 2_500, 20_000));

        client.set_emission_params(&params(50_000_000, 5_000, 15_000));
        assert_eq!(client.emission_params(), params(50_000_000, 5_000, 15_000));

        // Rebalanced pool size lands inside the new band.
        let user = Address::generate(&env);
        mint(&env, &token_id, &user, 30_000_000);
        client.stake(&user, &25_000_000, &0);
        assert_eq!(client.current_emission_multiplier_bps(), 15_000);
    }

    #[test]
    fn test_emission_params_default_without_init() {
        // An instance that predates dynamic scaling still resolves defaults.
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(StakingContract, ());
        let client = StakingContractClient::new(&env, &id);
        assert_eq!(client.emission_params(), default_emission_params());
        assert_eq!(client.total_staked(), 0);
        assert_eq!(client.current_emission_multiplier_bps(), 20_000);
    }

    #[test]
    #[should_panic(expected = "max multiplier below min")]
    fn test_set_emission_params_rejects_inverted_band() {
        let (_env, client, _admin, _token_id) = setup();
        client.set_emission_params(&params(CAPACITY, 20_000, 5_000));
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);
        client.stake(&user, &1000, &0);
        client.claim_rewards(&user);
    }

    #[test]
    fn test_pending_rewards_zero_without_stake() {
        let (env, client, _admin, _token_id) = setup();
        let user = Address::generate(&env);
        assert_eq!(client.pending_rewards(&user), 0);
    }

    #[test]
    fn test_pending_rewards_after_time() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.stake(&user, &1000, &0);
        env.ledger().set_timestamp(env.ledger().timestamp() + 1000);

        // rewards = (1000 * 1000 * 1000) / 10_000_000 = 100
        assert_eq!(client.pending_rewards(&user), 100);
    }

    #[test]
    fn test_stake_accumulates_rewards() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &20000);

        client.stake(&user, &1000, &0);
        env.ledger().set_timestamp(env.ledger().timestamp() + 10000);
        client.stake(&user, &500, &0);

        // Rewards accrued by the first stake over 10000s must be banked into
        // accumulated_rewards: (1000 * 1000 * 10000) / 10_000_000 = 1000
        let info = client.get_stake_info(&user);
        assert_eq!(info.accumulated_rewards, 1000);
    }

    #[test]
    fn test_stake_same_lock_different_tier_keeps_multiplier() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &20000);

        // Two tiers with identical lock duration but different multipliers
        let tiers = vec![
            &env,
            LockTier {
                lock_seconds: 3600,
                rate_multiplier: 100,
            },
            LockTier {
                lock_seconds: 3600,
                rate_multiplier: 125,
            },
        ];
        client.set_tiers(&tiers);

        client.stake(&user, &1000, &0);
        // Staking again at the same timestamp lands exactly on the current
        // lock_end. Since the lock is not extended, the rate multiplier must
        // stay at tier 0's value (100).
        client.stake(&user, &1000, &1);

        let info = client.get_stake_info(&user);
        assert_eq!(info.lock_end, env.ledger().timestamp() + 3600);
        assert_eq!(info.rate_multiplier, 100);
    }

    #[test]
    fn test_withdraw_at_exact_lock_end_no_penalty() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let token_client = token::Client::new(&env, &token_id);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.stake(&user, &1000, &0);
        let lock_end = env.ledger().timestamp() + 3600;

        // Advance exactly to lock_end (not beyond): no penalty applies
        env.ledger().set_timestamp(lock_end);
        stellar_asset_client.mint(&client.address, &400);

        client.withdraw(&user);

        // Full principal + rewards (1000 * 1000 * 3600 / 10_000_000 = 360)
        assert_eq!(token_client.balance(&user), 9000 + 1000 + 360);
    }

    #[test]
    fn test_emergency_withdraw_penalty_deduction() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let penalty_pool = Address::generate(&env);
        let token_client = token::Client::new(&env, &token_id);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.set_penalty_pool(&penalty_pool);
        client.stake(&user, &1000, &0);

        client.emergency_withdraw(&user);

        // 10% penalty on 1000 = 100, user gets 900
        assert_eq!(token_client.balance(&user), 9000 + 900);
        // Penalty pool receives 100
        assert_eq!(token_client.balance(&penalty_pool), 100);
    }

    #[test]
    fn test_emergency_withdraw_forfeits_rewards() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let penalty_pool = Address::generate(&env);
        let token_client = token::Client::new(&env, &token_id);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.set_penalty_pool(&penalty_pool);
        client.stake(&user, &1000, &0);

        // Advance time to accrue rewards
        env.ledger().set_timestamp(env.ledger().timestamp() + 1000);

        // Fund contract with reward tokens
        stellar_asset_client.mint(&client.address, &100);

        client.emergency_withdraw(&user);

        // User should only get 900 (90% of 1000), rewards are forfeited
        assert_eq!(token_client.balance(&user), 9000 + 900);
        // Contract should still have the 100 reward tokens
        assert_eq!(token_client.balance(&client.address), 100);
    }

    #[test]
    fn test_emergency_withdraw_resets_stake() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let penalty_pool = Address::generate(&env);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.set_penalty_pool(&penalty_pool);
        client.stake(&user, &1000, &0);

        client.emergency_withdraw(&user);

        let info = client.get_stake_info(&user);
        assert_eq!(info.amount, 0);
        assert_eq!(info.accumulated_rewards, 0);
    }

    #[test]
    #[should_panic(expected = "penalty pool not set")]
    fn test_emergency_withdraw_without_pool_panics() {
        let (env, client, _admin, token_id) = setup();
        let user = Address::generate(&env);
        let stellar_asset_client = StellarAssetClient::new(&env, &token_id);
        stellar_asset_client.mint(&user, &10000);

        client.stake(&user, &1000, &0);
        client.emergency_withdraw(&user);
    }

    #[test]
    #[should_panic(expected = "nothing to withdraw")]
    fn test_emergency_withdraw_nothing_panics() {
        let (env, client, _admin, _token_id) = setup();
        let user = Address::generate(&env);
        let penalty_pool = Address::generate(&env);

        client.set_penalty_pool(&penalty_pool);
        client.emergency_withdraw(&user);
    }
}
