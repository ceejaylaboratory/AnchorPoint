#![no_std]
//! Decentralized Circuit Breaker Protocol
//!
//! Implements a protocol-wide circuit breaker with:
//! - Tiered pausing: SwapOnly, WithdrawOnly, or All
//! - Timelocked unpausing to prevent abuse
//! - Autonomous triggers based on oracle price volatility
//! - Governance and authorized-bot trigger support

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Vec};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Default seconds that must elapse before an unpause can execute (1 hour).
const DEFAULT_TIMELOCK_SECONDS: u64 = 3_600;

/// Maximum number of authorized bots.
const MAX_BOTS: u32 = 10;

/// Default volatility threshold in basis points (10% = 1000 bps).
const DEFAULT_VOLATILITY_BPS: i128 = 1_000;

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    PauseTier,
    UnpauseUnlocksAt,
    PendingUnpauseTier,
    TimelockSeconds,
    AuthorizedBots,
    OracleContract,
    /// Per-asset reference price for volatility comparison.
    ReferencePrice(Address),
    VolatilityBps,
    TripCount,
}

// ── Types ─────────────────────────────────────────────────────────────────────

/// Tiered pause levels.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum PauseTier {
    /// Fully operational.
    None,
    /// Swap operations halted.
    SwapOnly,
    /// Withdrawal operations halted.
    WithdrawOnly,
    /// All operations halted.
    All,
}

/// Who triggered the circuit breaker.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum TriggerSource {
    Governance,
    Bot,
    Oracle,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct CircuitBreaker;

#[contractimpl]
impl CircuitBreaker {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the circuit breaker.
    ///
    /// Pass `timelock_secs = 0` or `volatility_bps = 0` to use the defaults.
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle: Address,
        timelock_secs: u64,
        volatility_bps: i128,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        let tl = if timelock_secs == 0 { DEFAULT_TIMELOCK_SECONDS } else { timelock_secs };
        let vbps = if volatility_bps == 0 { DEFAULT_VOLATILITY_BPS } else { volatility_bps };

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::OracleContract, &oracle);
        env.storage().instance().set(&DataKey::PauseTier, &PauseTier::None);
        env.storage().instance().set(&DataKey::TimelockSeconds, &tl);
        env.storage().instance().set(&DataKey::VolatilityBps, &vbps);
        env.storage().instance().set(&DataKey::UnpauseUnlocksAt, &0u64);
        env.storage().instance().set(&DataKey::TripCount, &0u32);

        let bots: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::AuthorizedBots, &bots);
    }

    // ── Bot management ────────────────────────────────────────────────────────

    /// Add an address to the authorized-bot list (admin only).
    pub fn add_bot(env: Env, caller: Address, bot: Address) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);

        let mut bots: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedBots)
            .unwrap_or_else(|| Vec::new(&env));

        assert!((bots.len() as u32) < MAX_BOTS, "bot list is full");

        for i in 0..bots.len() {
            if bots.get(i).unwrap() == bot {
                panic!("bot already authorized");
            }
        }

        bots.push_back(bot.clone());
        // Topic: event name only; bot + caller Addresses in data.
        env.storage().instance().set(&DataKey::AuthorizedBots, &bots);
        env.events().publish(symbol_short!("bot_add"), (bot, caller));
    }

    /// Remove an address from the authorized-bot list (admin only).
    pub fn remove_bot(env: Env, caller: Address, bot: Address) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);

        let bots: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedBots)
            .unwrap_or_else(|| Vec::new(&env));

        let mut new_bots: Vec<Address> = Vec::new(&env);
        let mut found = false;
        for i in 0..bots.len() {
            let b = bots.get(i).unwrap();
            if b == bot {
                found = true;
            } else {
                new_bots.push_back(b);
            }
        }
        assert!(found, "bot not found");
        env.storage().instance().set(&DataKey::AuthorizedBots, &new_bots);
        // Topic: event name only; bot + caller Addresses in data.
        env.events().publish(symbol_short!("bot_rm"), (bot, caller));
    }

    // ── Pause (trip) ──────────────────────────────────────────────────────────

    /// Trip the circuit breaker to a given tier.
    ///
    /// Callable by the admin (governance) or any authorized bot.
    pub fn trip(env: Env, caller: Address, tier: PauseTier) {
        caller.require_auth();
        assert!(tier != PauseTier::None, "use unpause to clear the breaker");

        let source = if Self::is_admin(&env, &caller) {
            TriggerSource::Governance
        } else if Self::is_bot(&env, &caller) {
            TriggerSource::Bot
        } else {
            panic!("caller is not authorized to trip the breaker");
        };

        Self::apply_trip(&env, tier, source, caller);
    }

    /// Oracle-driven autonomous trip.
    ///
    /// Permissionless — anyone can call. Fetches the current price from the
    /// oracle, compares it to the stored reference price for `asset`, and trips
    /// to `PauseTier::All` if the deviation exceeds `volatility_bps`.
    /// The reference price is updated on every call.
    pub fn oracle_trip(env: Env, caller: Address, asset: Address) {
        caller.require_auth();

        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleContract)
            .expect("oracle not configured");

        // Call oracle's `get_price(asset) -> i128`
        let current_price: i128 = env.invoke_contract(
            &oracle,
            &symbol_short!("get_price"),
            (asset.clone(),).into_val(&env),
        );

        assert!(current_price > 0, "oracle returned non-positive price");

        let volatility_bps: i128 = env
            .storage()
            .instance()
            .get(&DataKey::VolatilityBps)
            .unwrap_or(DEFAULT_VOLATILITY_BPS);

        let maybe_ref: Option<i128> = env
            .storage()
            .instance()
            .get(&DataKey::ReferencePrice(asset.clone()));

        // Always update reference price for the next observation window.
        env.storage()
            .instance()
            .set(&DataKey::ReferencePrice(asset.clone()), &current_price);

        let ref_price = match maybe_ref {
            None => {
                // First observation — store and return without tripping.
                env.events()
                    .publish(symbol_short!("ref_set"), (asset, current_price));
                return;
            }
            Some(p) => p,
        };

        // deviation_bps = |current - ref| * 10_000 / ref
        let diff = if current_price > ref_price {
            current_price - ref_price
        } else {
            ref_price - current_price
        };
        let deviation_bps = diff
            .checked_mul(10_000)
            .expect("overflow in deviation calc")
            / ref_price;

        if deviation_bps >= volatility_bps {
            Self::apply_trip(&env, PauseTier::All, TriggerSource::Oracle, caller.clone());
            // Topic: event name only; asset + deviation data in payload.
            env.events().publish(
                symbol_short!("vol_trip"),
                (asset, deviation_bps, volatility_bps),
            );
        } else {
            env.events().publish(
                symbol_short!("vol_ok"),
                (asset, deviation_bps, volatility_bps),
            );
        }
    }

    // ── Unpause (timelock) ────────────────────────────────────────────────────

    /// Initiate the unpause timelock (admin only).
    ///
    /// Schedules a transition to `target_tier` after the configured timelock
    /// duration. Call `execute_unpause` once the window has elapsed.
    pub fn initiate_unpause(env: Env, caller: Address, target_tier: PauseTier) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);

        let current: PauseTier = env
            .storage()
            .instance()
            .get(&DataKey::PauseTier)
            .unwrap_or(PauseTier::None);

        assert!(current != PauseTier::None, "protocol is not paused");

        let timelock: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TimelockSeconds)
            .unwrap_or(DEFAULT_TIMELOCK_SECONDS);

        let unlocks_at = env.ledger().timestamp() + timelock;

        env.storage()
            .instance()
            .set(&DataKey::UnpauseUnlocksAt, &unlocks_at);
        env.storage()
            .instance()
            .set(&DataKey::PendingUnpauseTier, &target_tier);

        // Topic: event name only; caller + unlocks_at + target_tier in data.
        env.events().publish(
            symbol_short!("unp_init"),
            (caller, unlocks_at, target_tier),
        );
    }

    /// Execute the pending unpause once the timelock has expired.
    ///
    /// Permissionless — anyone can call after the window so governance cannot
    /// be held hostage by a single key.
    pub fn execute_unpause(env: Env) {
        let unlocks_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::UnpauseUnlocksAt)
            .unwrap_or(0);

        assert!(unlocks_at > 0, "no unpause pending");
        assert!(
            env.ledger().timestamp() >= unlocks_at,
            "timelock has not expired yet"
        );

        let target: PauseTier = env
            .storage()
            .instance()
            .get(&DataKey::PendingUnpauseTier)
            .unwrap_or(PauseTier::None);

        env.storage().instance().set(&DataKey::PauseTier, &target);
        env.storage().instance().set(&DataKey::UnpauseUnlocksAt, &0u64);

        env.events()
            .publish((symbol_short!("unpaused"), target), env.ledger().timestamp());
    }

    /// Cancel a pending unpause (admin only).
    ///
    /// Useful when a new threat is detected during the timelock window.
    pub fn cancel_unpause(env: Env, caller: Address) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);

        let unlocks_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::UnpauseUnlocksAt)
            .unwrap_or(0);

        assert!(unlocks_at > 0, "no unpause pending");

        env.storage().instance().set(&DataKey::UnpauseUnlocksAt, &0u64);
        // Topic: event name only; caller + unlocks_at in data.
        env.events().publish(symbol_short!("unp_cncl"), (caller, unlocks_at));
    }

    // ── Configuration ─────────────────────────────────────────────────────────

    /// Update the timelock duration in seconds (admin only).
    pub fn set_timelock(env: Env, caller: Address, seconds: u64) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        assert!(seconds > 0, "timelock must be positive");
        env.storage().instance().set(&DataKey::TimelockSeconds, &seconds);
        // Topic: event name only; caller + seconds in data.
        env.events().publish(symbol_short!("tl_set"), (caller, seconds));
    }

    /// Update the oracle volatility threshold in basis points (admin only).
    pub fn set_volatility_bps(env: Env, caller: Address, bps: i128) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        assert!(bps > 0 && bps <= 10_000, "bps must be 1-10000");
        env.storage().instance().set(&DataKey::VolatilityBps, &bps);
        // Topic: event name only; caller + bps in data.
        env.events().publish(symbol_short!("vbps_set"), (caller, bps));
    }

    /// Update the oracle contract address (admin only).
    pub fn set_oracle(env: Env, caller: Address, oracle: Address) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        env.storage().instance().set(&DataKey::OracleContract, &oracle);
        // Topic: event name only; oracle + caller Addresses in data.
        env.events().publish(symbol_short!("ora_set"), (oracle, caller));
    }

    // ── Read-only helpers ─────────────────────────────────────────────────────

    /// Returns the current pause tier.
    pub fn get_pause_tier(env: Env) -> PauseTier {
        env.storage()
            .instance()
            .get(&DataKey::PauseTier)
            .unwrap_or(PauseTier::None)
    }

    /// Returns true if swap operations are currently halted.
    pub fn is_swap_paused(env: Env) -> bool {
        matches!(Self::get_pause_tier(env), PauseTier::SwapOnly | PauseTier::All)
    }

    /// Returns true if withdrawal operations are currently halted.
    pub fn is_withdraw_paused(env: Env) -> bool {
        matches!(Self::get_pause_tier(env), PauseTier::WithdrawOnly | PauseTier::All)
    }

    /// Returns true if all operations are halted.
    pub fn is_all_paused(env: Env) -> bool {
        Self::get_pause_tier(env) == PauseTier::All
    }

    /// Returns the timestamp when the pending unpause unlocks (0 = none pending).
    pub fn get_unpause_unlock_time(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::UnpauseUnlocksAt)
            .unwrap_or(0)
    }

    /// Returns the total number of times the breaker has been tripped.
    pub fn get_trip_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TripCount)
            .unwrap_or(0)
    }

    /// Returns the current timelock duration in seconds.
    pub fn get_timelock(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::TimelockSeconds)
            .unwrap_or(DEFAULT_TIMELOCK_SECONDS)
    }

    /// Returns the current volatility threshold in basis points.
    pub fn get_volatility_bps(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::VolatilityBps)
            .unwrap_or(DEFAULT_VOLATILITY_BPS)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn assert_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not configured");
        assert!(*caller == admin, "caller is not admin");
    }

    fn is_admin(env: &Env, caller: &Address) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Admin)
            .map(|a| a == *caller)
            .unwrap_or(false)
    }

    fn is_bot(env: &Env, caller: &Address) -> bool {
        let bots: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AuthorizedBots)
            .unwrap_or_else(|| Vec::new(env));
        for i in 0..bots.len() {
            if bots.get(i).unwrap() == *caller {
                return true;
            }
        }
        false
    }

    /// Core trip logic shared by all trigger paths.
    fn apply_trip(env: &Env, tier: PauseTier, source: TriggerSource, caller: Address) {
        env.storage().instance().set(&DataKey::PauseTier, &tier);

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TripCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TripCount, &(count + 1));

        env.events()
            .publish((symbol_short!("tripped"), tier), (caller, source));
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    // ── Initialization ────────────────────────────────────────────────────────

    #[test]
    fn test_initialize_defaults() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &0u64, &0i128);

        assert_eq!(c.get_pause_tier(), PauseTier::None);
        assert_eq!(c.get_timelock(), DEFAULT_TIMELOCK_SECONDS);
        assert_eq!(c.get_volatility_bps(), DEFAULT_VOLATILITY_BPS);
        assert_eq!(c.get_trip_count(), 0);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        // second call must panic
        c.initialize(&admin, &oracle, &3600u64, &500i128);
    }

    // ── Tiered pausing ────────────────────────────────────────────────────────

    #[test]
    fn test_governance_trip_swap_only() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.trip(&admin, &PauseTier::SwapOnly);
        assert_eq!(c.get_pause_tier(), PauseTier::SwapOnly);
        assert!(c.is_swap_paused());
        assert!(!c.is_withdraw_paused());
        assert!(!c.is_all_paused());
        assert_eq!(c.get_trip_count(), 1);
    }

    #[test]
    fn test_governance_trip_withdraw_only() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.trip(&admin, &PauseTier::WithdrawOnly);
        assert_eq!(c.get_pause_tier(), PauseTier::WithdrawOnly);
        assert!(!c.is_swap_paused());
        assert!(c.is_withdraw_paused());
        assert!(!c.is_all_paused());
    }

    #[test]
    fn test_governance_trip_all() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.trip(&admin, &PauseTier::All);
        assert_eq!(c.get_pause_tier(), PauseTier::All);
        assert!(c.is_swap_paused());
        assert!(c.is_withdraw_paused());
        assert!(c.is_all_paused());
    }

    #[test]
    #[should_panic(expected = "use unpause to clear the breaker")]
    fn test_trip_none_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.trip(&admin, &PauseTier::None);
    }

    #[test]
    #[should_panic(expected = "caller is not authorized to trip the breaker")]
    fn test_unauthorized_trip_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let rando = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.trip(&rando, &PauseTier::All);
    }

    // ── Bot management ────────────────────────────────────────────────────────

    #[test]
    fn test_bot_can_trip() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let bot = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.add_bot(&admin, &bot);
        c.trip(&bot, &PauseTier::SwapOnly);
        assert_eq!(c.get_pause_tier(), PauseTier::SwapOnly);
    }

    #[test]
    #[should_panic(expected = "bot already authorized")]
    fn test_duplicate_bot_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let bot = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.add_bot(&admin, &bot);
        c.add_bot(&admin, &bot);
    }

    #[test]
    #[should_panic(expected = "caller is not authorized to trip the breaker")]
    fn test_remove_bot_revokes_access() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let bot = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.add_bot(&admin, &bot);
        c.remove_bot(&admin, &bot);
        // bot is no longer authorized — must panic
        c.trip(&bot, &PauseTier::All);
    }

    #[test]
    #[should_panic(expected = "bot not found")]
    fn test_remove_nonexistent_bot_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let ghost = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.remove_bot(&admin, &ghost);
    }

    // ── Timelock unpause ──────────────────────────────────────────────────────

    #[test]
    fn test_initiate_and_execute_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &100u64, &500i128);

        c.trip(&admin, &PauseTier::All);
        assert!(c.is_all_paused());

        c.initiate_unpause(&admin, &PauseTier::None);
        let unlock_time = c.get_unpause_unlock_time();
        assert!(unlock_time > 0);

        // Advance ledger past the timelock.
        env.ledger().with_mut(|l| l.timestamp = unlock_time + 1);

        c.execute_unpause();
        assert_eq!(c.get_pause_tier(), PauseTier::None);
        assert_eq!(c.get_unpause_unlock_time(), 0);
    }

    #[test]
    #[should_panic(expected = "timelock has not expired yet")]
    fn test_execute_unpause_before_timelock_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.trip(&admin, &PauseTier::All);
        c.initiate_unpause(&admin, &PauseTier::None);
        // Time not advanced — must panic.
        c.execute_unpause();
    }

    #[test]
    #[should_panic(expected = "no unpause pending")]
    fn test_execute_unpause_without_initiate_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.execute_unpause();
    }

    #[test]
    #[should_panic(expected = "protocol is not paused")]
    fn test_initiate_unpause_when_not_paused_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.initiate_unpause(&admin, &PauseTier::None);
    }

    #[test]
    fn test_cancel_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.trip(&admin, &PauseTier::All);
        c.initiate_unpause(&admin, &PauseTier::None);
        assert!(c.get_unpause_unlock_time() > 0);
        c.cancel_unpause(&admin);
        assert_eq!(c.get_unpause_unlock_time(), 0);
    }

    #[test]
    fn test_downgrade_tier_via_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &60u64, &500i128);

        c.trip(&admin, &PauseTier::All);
        // Downgrade to SwapOnly instead of fully unpausing.
        c.initiate_unpause(&admin, &PauseTier::SwapOnly);
        let unlock_time = c.get_unpause_unlock_time();
        env.ledger().with_mut(|l| l.timestamp = unlock_time);
        c.execute_unpause();
        assert_eq!(c.get_pause_tier(), PauseTier::SwapOnly);
    }

    // ── Configuration ─────────────────────────────────────────────────────────

    #[test]
    fn test_set_timelock() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.set_timelock(&admin, &7200u64);
        assert_eq!(c.get_timelock(), 7200);
    }

    #[test]
    #[should_panic(expected = "timelock must be positive")]
    fn test_set_zero_timelock_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.set_timelock(&admin, &0u64);
    }

    #[test]
    fn test_set_volatility_bps() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.set_volatility_bps(&admin, &2000i128);
        assert_eq!(c.get_volatility_bps(), 2000);
    }

    #[test]
    #[should_panic(expected = "bps must be 1-10000")]
    fn test_set_invalid_volatility_bps_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.set_volatility_bps(&admin, &0i128);
    }

    // ── Trip count ────────────────────────────────────────────────────────────

    #[test]
    fn test_trip_count_increments() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let bot = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &60u64, &500i128);
        c.add_bot(&admin, &bot);

        c.trip(&admin, &PauseTier::SwapOnly);
        assert_eq!(c.get_trip_count(), 1);

        // Unpause so we can trip again.
        c.initiate_unpause(&admin, &PauseTier::None);
        let unlock_time = c.get_unpause_unlock_time();
        env.ledger().with_mut(|l| l.timestamp = unlock_time);
        c.execute_unpause();

        c.trip(&bot, &PauseTier::All);
        assert_eq!(c.get_trip_count(), 2);
    }
}
