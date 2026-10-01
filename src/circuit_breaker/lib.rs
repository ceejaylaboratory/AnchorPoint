#![no_std]
//! Decentralized Circuit Breaker Protocol
//!
//! Implements a protocol-wide circuit breaker with:
//! - Tiered pausing: SwapOnly, WithdrawOnly, or All
//! - Timelocked unpausing to prevent abuse
//! - Autonomous triggers based on oracle price volatility
//! - Governance and authorized-bot trigger support
//! - Automatic 2-hour cooldown when rolling 1-hour volume spikes above a
//!   configured multiple (default 300%) of the baseline hourly volume

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Vec};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Default seconds that must elapse before an unpause can execute (1 hour).
const DEFAULT_TIMELOCK_SECONDS: u64 = 3_600;

/// Maximum number of authorized bots.
const MAX_BOTS: u32 = 10;

/// Default volatility threshold in basis points (10% = 1000 bps).
const DEFAULT_VOLATILITY_BPS: i128 = 1_000;

/// Default volume threshold in XLM (1,000,000 XLM).
const DEFAULT_VOLUME_THRESHOLD: i128 = 1_000_000;

/// Rolling window duration in seconds (1 hour).
const WINDOW_DURATION_SECONDS: u64 = 3_600;

/// Default spike multiplier in basis points (300% of baseline = 30,000 bps).
const DEFAULT_SPIKE_MULTIPLIER_BPS: i128 = 30_000;

/// Duration of the automatic cooldown triggered by a volume spike (2 hours).
const SPIKE_COOLDOWN_SECONDS: u64 = 7_200;

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
    /// Volume threshold for autonomous volume-based tripping.
    VolumeThreshold,
    /// Rolling window of volume entries: (ledger_timestamp, amount).
    VolumeWindow,
    /// Cached boolean mirror of whether the breaker is currently engaged.
    ///
    /// Kept in sync with `PauseTier` on every state transition so integrators
    /// can read a single cheap flag instead of matching on the tier enum.
    IsPaused,
    /// Expected (normal) volume per rolling hour; 0 disables spike detection.
    VolumeBaseline,
    /// Spike threshold as a multiple of the baseline, in basis points.
    SpikeMultiplierBps,
    /// Timestamp until which a spike-triggered cooldown halts all operations.
    CooldownUntil,
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

/// A single volume entry in the rolling window.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VolumeEntry {
    pub timestamp: u64,
    pub amount: i128,
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

#[allow(deprecated)]
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

        let tl = if timelock_secs == 0 {
            DEFAULT_TIMELOCK_SECONDS
        } else {
            timelock_secs
        };
        let vbps = if volatility_bps == 0 {
            DEFAULT_VOLATILITY_BPS
        } else {
            volatility_bps
        };

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::OracleContract, &oracle);
        env.storage()
            .instance()
            .set(&DataKey::PauseTier, &PauseTier::None);
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.storage().instance().set(&DataKey::TimelockSeconds, &tl);
        env.storage().instance().set(&DataKey::VolatilityBps, &vbps);
        env.storage()
            .instance()
            .set(&DataKey::UnpauseUnlocksAt, &0u64);
        env.storage().instance().set(&DataKey::TripCount, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::VolumeThreshold, &DEFAULT_VOLUME_THRESHOLD);

        let window: Vec<VolumeEntry> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::VolumeWindow, &window);

        let bots: Vec<Address> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedBots, &bots);
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

        assert!(bots.len() < MAX_BOTS, "bot list is full");

        for i in 0..bots.len() {
            if bots.get(i).unwrap() == bot {
                panic!("bot already authorized");
            }
        }

        bots.push_back(bot.clone());
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedBots, &bots);
        env.events()
            .publish((symbol_short!("bot_add"), bot), caller);
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
        env.storage()
            .instance()
            .set(&DataKey::AuthorizedBots, &new_bots);
        env.events().publish((symbol_short!("bot_rm"), bot), caller);
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
                env.events().publish(
                    (symbol_short!("cb"), symbol_short!("ref_set")),
                    (asset, current_price),
                );
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
                (symbol_short!("cb"), symbol_short!("vol_trip")),
                (asset.clone(), deviation_bps, volatility_bps),
            );
        } else {
            env.events().publish(
                (symbol_short!("cb"), symbol_short!("vol_ok")),
                (asset.clone(), deviation_bps, volatility_bps),
            );
        }
    }

    // ── Volume-based trigger ───────────────────────────────────────────────────

    /// Record a volume entry into the rolling hourly window.
    ///
    /// Prunes entries older than 1 hour, adds the new amount, and trips the
    /// breaker to `PauseTier::All` if the total volume in the window exceeds
    /// the configured threshold.
    ///
    /// Permissionless — any caller can record volume.
    pub fn record_volume(env: Env, amount: i128) {
        assert!(amount > 0, "amount must be positive");

        let now = env.ledger().timestamp();
        let threshold: i128 = env
            .storage()
            .instance()
            .get(&DataKey::VolumeThreshold)
            .unwrap_or(DEFAULT_VOLUME_THRESHOLD);

        // Prune old entries and compute current volume.
        let mut window: Vec<VolumeEntry> = env
            .storage()
            .instance()
            .get(&DataKey::VolumeWindow)
            .unwrap_or_else(|| Vec::new(&env));

        let mut pruned: Vec<VolumeEntry> = Vec::new(&env);
        let mut total: i128 = 0;

        for i in 0..window.len() {
            if let Some(entry) = window.get(i) {
                if now.saturating_sub(entry.timestamp) < WINDOW_DURATION_SECONDS {
                    total = total.checked_add(entry.amount).expect("overflow");
                    pruned.push_back(entry);
                }
            }
        }

        // Add the new entry.
        total = total.checked_add(amount).expect("overflow");
        pruned.push_back(VolumeEntry {
            timestamp: now,
            amount,
        });

        env.storage()
            .instance()
            .set(&DataKey::VolumeWindow, &pruned);

        env.events().publish(
            (symbol_short!("cb"), symbol_short!("vol_rec")),
            (amount, total, threshold),
        );

        // Trip if threshold is exceeded.
        if total > threshold {
            Self::apply_trip(
                &env,
                PauseTier::All,
                TriggerSource::Oracle,
                env.current_contract_address(),
            );
            env.events().publish(
                (symbol_short!("cb"), symbol_short!("vol_trp")),
                (total, threshold),
            );
        }

        Self::check_volume_spike(&env, now, total);
    }

    /// Set the expected volume per rolling hour used for spike detection
    /// (admin only). Pass 0 to disable spike detection.
    pub fn set_volume_baseline(env: Env, caller: Address, baseline: i128) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        assert!(baseline >= 0, "baseline must not be negative");
        env.storage()
            .instance()
            .set(&DataKey::VolumeBaseline, &baseline);
        env.events().publish(
            (symbol_short!("cb"), symbol_short!("base_set")),
            (caller, baseline),
        );
    }

    /// Set the spike multiplier in basis points (admin only).
    ///
    /// A cooldown triggers when window volume exceeds
    /// `baseline * multiplier_bps / 10_000`. Must be above 10,000 (100%) so
    /// that ordinary baseline activity can never trigger it.
    pub fn set_spike_multiplier_bps(env: Env, caller: Address, multiplier_bps: i128) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        assert!(multiplier_bps > 10_000, "multiplier must exceed 10000 bps");
        env.storage()
            .instance()
            .set(&DataKey::SpikeMultiplierBps, &multiplier_bps);
        env.events().publish(
            (symbol_short!("cb"), symbol_short!("spk_set")),
            (caller, multiplier_bps),
        );
    }

    /// Update the volume threshold (admin only).
    pub fn set_volume_threshold(env: Env, caller: Address, threshold: i128) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        assert!(threshold > 0, "threshold must be positive");
        env.storage()
            .instance()
            .set(&DataKey::VolumeThreshold, &threshold);
        env.events()
            .publish((symbol_short!("vthr_set"), caller), threshold);
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

        let unlocks_at = env
            .ledger()
            .timestamp()
            .checked_add(timelock)
            .expect("timelock overflow");

        env.storage()
            .instance()
            .set(&DataKey::UnpauseUnlocksAt, &unlocks_at);
        env.storage()
            .instance()
            .set(&DataKey::PendingUnpauseTier, &target_tier);

        // Topic: event name only; caller + unlocks_at + target_tier in data.
        env.events().publish(
            (symbol_short!("cb"), symbol_short!("unp_init")),
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
        env.storage()
            .instance()
            .set(&DataKey::IsPaused, &(target != PauseTier::None));
        env.storage()
            .instance()
            .set(&DataKey::UnpauseUnlocksAt, &0u64);

        env.events().publish(
            (symbol_short!("unpaused"), target),
            env.ledger().timestamp(),
        );
    }

    /// Immediately resume protocol operations (admin only).
    ///
    /// This is the emergency counterpart to the timelocked
    /// [`Self::initiate_unpause`] / [`Self::execute_unpause`] flow. The timelock
    /// exists so a single compromised key cannot silently re-open the protocol
    /// on a normal schedule; this escape hatch is deliberately restricted to the
    /// admin and is intended for false-positive trips (e.g. an autonomous volume
    /// or oracle trigger firing on benign activity) where waiting out the
    /// timelock would itself be the outage.
    ///
    /// Clears any pending unpause so a stale scheduled transition cannot fire
    /// afterwards and re-pause or re-tier the protocol unexpectedly. Also lifts
    /// an active volume-spike cooldown.
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        Self::assert_admin(&env, &admin);

        let current: PauseTier = env
            .storage()
            .instance()
            .get(&DataKey::PauseTier)
            .unwrap_or(PauseTier::None);

        assert!(
            current != PauseTier::None || Self::is_in_cooldown(env.clone()),
            "protocol is not paused"
        );

        env.storage()
            .instance()
            .set(&DataKey::PauseTier, &PauseTier::None);
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.storage().instance().set(&DataKey::CooldownUntil, &0u64);

        // Drop any scheduled unpause so it cannot execute against stale state.
        env.storage()
            .instance()
            .set(&DataKey::UnpauseUnlocksAt, &0u64);

        // Topic: event name only; admin + timestamp in data.
        env.events().publish(
            (symbol_short!("cb"), symbol_short!("resumed")),
            (admin, env.ledger().timestamp()),
        );
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

        env.storage()
            .instance()
            .set(&DataKey::UnpauseUnlocksAt, &0u64);
        env.events()
            .publish((symbol_short!("unp_cncl"), caller), unlocks_at);
    }

    // ── Configuration ─────────────────────────────────────────────────────────

    /// Update the timelock duration in seconds (admin only).
    pub fn set_timelock(env: Env, caller: Address, seconds: u64) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        assert!(seconds > 0, "timelock must be positive");
        env.storage()
            .instance()
            .set(&DataKey::TimelockSeconds, &seconds);
        env.events()
            .publish((symbol_short!("tl_set"), caller), seconds);
    }

    /// Update the oracle volatility threshold in basis points (admin only).
    pub fn set_volatility_bps(env: Env, caller: Address, bps: i128) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        assert!(bps > 0 && bps <= 10_000, "bps must be 1-10000");
        env.storage().instance().set(&DataKey::VolatilityBps, &bps);
        env.events()
            .publish((symbol_short!("vbps_set"), caller), bps);
    }

    /// Update the oracle contract address (admin only).
    pub fn set_oracle(env: Env, caller: Address, oracle: Address) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        env.storage()
            .instance()
            .set(&DataKey::OracleContract, &oracle);
        env.events()
            .publish((symbol_short!("ora_set"), oracle), caller);
    }

    // ── Read-only helpers ─────────────────────────────────────────────────────

    /// Returns the effective pause tier.
    ///
    /// Reports `PauseTier::All` while a volume-spike cooldown is active,
    /// otherwise the tier set by governance, bots or the oracle.
    pub fn get_pause_tier(env: Env) -> PauseTier {
        if Self::is_in_cooldown(env.clone()) {
            return PauseTier::All;
        }
        env.storage()
            .instance()
            .get(&DataKey::PauseTier)
            .unwrap_or(PauseTier::None)
    }

    /// Returns true if swap operations are currently halted.
    pub fn is_swap_paused(env: Env) -> bool {
        matches!(
            Self::get_pause_tier(env),
            PauseTier::SwapOnly | PauseTier::All
        )
    }

    /// Returns true if withdrawal operations are currently halted.
    pub fn is_withdraw_paused(env: Env) -> bool {
        matches!(
            Self::get_pause_tier(env),
            PauseTier::WithdrawOnly | PauseTier::All
        )
    }

    /// Returns true if all operations are halted.
    pub fn is_all_paused(env: Env) -> bool {
        Self::get_pause_tier(env) == PauseTier::All
    }

    /// Returns true if the breaker is engaged at any tier or a volume-spike
    /// cooldown is active.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
            || Self::is_in_cooldown(env)
    }

    /// Returns true while a volume-spike cooldown is in effect.
    pub fn is_in_cooldown(env: Env) -> bool {
        env.ledger().timestamp() < Self::get_cooldown_until(env)
    }

    /// Returns the timestamp the current cooldown ends at (0 = never triggered).
    pub fn get_cooldown_until(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CooldownUntil)
            .unwrap_or(0)
    }

    /// Returns the baseline hourly volume used for spike detection.
    pub fn get_volume_baseline(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::VolumeBaseline)
            .unwrap_or(0)
    }

    /// Returns the spike multiplier in basis points.
    pub fn get_spike_multiplier_bps(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::SpikeMultiplierBps)
            .unwrap_or(DEFAULT_SPIKE_MULTIPLIER_BPS)
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

    /// Returns the current volume threshold in XLM.
    pub fn get_volume_threshold(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::VolumeThreshold)
            .unwrap_or(DEFAULT_VOLUME_THRESHOLD)
    }

    /// Returns the total volume recorded in the current rolling window.
    pub fn get_window_volume(env: Env) -> i128 {
        let now = env.ledger().timestamp();
        let window: Vec<VolumeEntry> = env
            .storage()
            .instance()
            .get(&DataKey::VolumeWindow)
            .unwrap_or_else(|| Vec::new(&env));

        let mut total: i128 = 0;
        for i in 0..window.len() {
            if let Some(entry) = window.get(i) {
                if now.saturating_sub(entry.timestamp) < WINDOW_DURATION_SECONDS {
                    total = total.checked_add(entry.amount).expect("overflow");
                }
            }
        }
        total
    }

    /// Returns the number of entries currently in the rolling volume window.
    pub fn get_volume_entry_count(env: Env) -> u32 {
        let window: Vec<VolumeEntry> = env
            .storage()
            .instance()
            .get(&DataKey::VolumeWindow)
            .unwrap_or_else(|| Vec::new(&env));
        window.len()
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

    /// Start or extend the 2-hour cooldown if `window_total` exceeds the
    /// configured multiple of the baseline. No-op when no baseline is set.
    fn check_volume_spike(env: &Env, now: u64, window_total: i128) {
        let baseline = Self::get_volume_baseline(env.clone());
        if baseline == 0 {
            return;
        }
        let multiplier_bps = Self::get_spike_multiplier_bps(env.clone());
        let spike_threshold = baseline
            .checked_mul(multiplier_bps)
            .expect("overflow in spike threshold")
            / 10_000;

        if window_total <= spike_threshold {
            return;
        }

        let was_cooling_down = Self::is_in_cooldown(env.clone());
        // Sustained spikes keep pushing the cooldown out; it never shrinks.
        let until = now
            .checked_add(SPIKE_COOLDOWN_SECONDS)
            .expect("cooldown overflow")
            .max(Self::get_cooldown_until(env.clone()));
        env.storage()
            .instance()
            .set(&DataKey::CooldownUntil, &until);

        if !was_cooling_down {
            let count: u32 = env
                .storage()
                .instance()
                .get(&DataKey::TripCount)
                .unwrap_or(0);
            env.storage().instance().set(
                &DataKey::TripCount,
                &count.checked_add(1).expect("trip count overflow"),
            );
        }

        env.events().publish(
            (symbol_short!("cb"), symbol_short!("cooldown")),
            (window_total, spike_threshold, until),
        );
    }

    /// Core trip logic shared by all trigger paths.
    fn apply_trip(env: &Env, tier: PauseTier, source: TriggerSource, caller: Address) {
        env.storage().instance().set(&DataKey::PauseTier, &tier);
        env.storage()
            .instance()
            .set(&DataKey::IsPaused, &(tier != PauseTier::None));

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::TripCount)
            .unwrap_or(0);
        env.storage().instance().set(
            &DataKey::TripCount,
            &count.checked_add(1).expect("trip count overflow"),
        );

        env.events()
            .publish((symbol_short!("tripped"), tier), (caller, source));
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Env,
    };

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

    // ── Volume threshold tests ─────────────────────────────────────────────────

    #[test]
    fn test_volume_defaults() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        assert_eq!(c.get_volume_threshold(), DEFAULT_VOLUME_THRESHOLD);
        assert_eq!(c.get_window_volume(), 0);
        assert_eq!(c.get_volume_entry_count(), 0);
    }

    #[test]
    fn test_record_volume_below_threshold() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.record_volume(&500_000i128);
        assert_eq!(c.get_window_volume(), 500_000);
        assert_eq!(c.get_volume_entry_count(), 1);
        // Should NOT be paused
        assert_eq!(c.get_pause_tier(), PauseTier::None);
    }

    #[test]
    fn test_record_volume_exceeds_threshold() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.record_volume(&1_500_000i128);
        // Should trip to All
        assert_eq!(c.get_pause_tier(), PauseTier::All);
        assert!(c.is_all_paused());
    }

    #[test]
    fn test_record_volume_accumulates() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.record_volume(&400_000i128);
        c.record_volume(&300_000i128);
        c.record_volume(&200_000i128);

        assert_eq!(c.get_window_volume(), 900_000);
        assert_eq!(c.get_volume_entry_count(), 3);
        assert_eq!(c.get_pause_tier(), PauseTier::None);
    }

    #[test]
    fn test_window_prunes_old_entries() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        // Record initial volume
        c.record_volume(&600_000i128);
        assert_eq!(c.get_window_volume(), 600_000);

        // Advance ledger past the 1-hour window
        env.ledger()
            .with_mut(|l| l.timestamp = WINDOW_DURATION_SECONDS + 1);

        // Record new volume — old entry should be pruned
        c.record_volume(&100_000i128);
        assert_eq!(c.get_window_volume(), 100_000);
        assert_eq!(c.get_volume_entry_count(), 1);
    }

    #[test]
    fn test_set_volume_threshold() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.set_volume_threshold(&admin, &500_000i128);
        assert_eq!(c.get_volume_threshold(), 500_000);

        // Now 600_000 should exceed the new threshold
        c.record_volume(&600_000i128);
        assert_eq!(c.get_pause_tier(), PauseTier::All);
    }

    #[test]
    #[should_panic(expected = "threshold must be positive")]
    fn test_set_zero_volume_threshold_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.set_volume_threshold(&admin, &0i128);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_record_zero_volume_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        c.record_volume(&0i128);
    }

    // ── Emergency pause/resume toggle ─────────────────────────────────────────

    fn setup_cb(env: &Env) -> (Address, CircuitBreakerClient<'static>) {
        let admin = Address::generate(env);
        let oracle = Address::generate(env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);
        (admin, c)
    }

    #[test]
    fn test_is_paused_false_after_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, c) = setup_cb(&env);
        assert!(!c.is_paused());
        assert_eq!(c.get_pause_tier(), PauseTier::None);
    }

    #[test]
    fn test_trip_sets_is_paused_for_every_tier() {
        for tier in [PauseTier::SwapOnly, PauseTier::WithdrawOnly, PauseTier::All] {
            let env = Env::default();
            env.mock_all_auths();
            let (admin, c) = setup_cb(&env);

            c.trip(&admin, &tier);
            assert!(c.is_paused(), "is_paused must be true after tripping");
            assert_eq!(c.get_pause_tier(), tier);

            c.unpause(&admin);
            assert!(!c.is_paused(), "is_paused must be false after unpause");
            assert_eq!(c.get_pause_tier(), PauseTier::None);
        }
    }

    #[test]
    fn test_unpause_resumes_immediately_without_timelock() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, c) = setup_cb(&env);

        c.trip(&admin, &PauseTier::All);
        assert!(c.is_all_paused());

        // No ledger advance: the emergency path must not wait for the timelock.
        c.unpause(&admin);

        assert_eq!(c.get_pause_tier(), PauseTier::None);
        assert!(!c.is_paused());
        assert!(!c.is_all_paused());
        assert!(!c.is_swap_paused());
        assert!(!c.is_withdraw_paused());
    }

    #[test]
    fn test_unpause_clears_pending_timelocked_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, c) = setup_cb(&env);

        c.trip(&admin, &PauseTier::All);
        c.initiate_unpause(&admin, &PauseTier::SwapOnly);
        assert!(c.get_unpause_unlock_time() > 0);

        c.unpause(&admin);

        // The scheduled transition must be dropped, not left armed.
        assert_eq!(c.get_unpause_unlock_time(), 0);
        assert_eq!(c.get_pause_tier(), PauseTier::None);
        assert!(!c.is_paused());
    }

    #[test]
    #[should_panic(expected = "no unpause pending")]
    fn test_execute_unpause_after_emergency_unpause_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, c) = setup_cb(&env);

        c.trip(&admin, &PauseTier::All);
        c.initiate_unpause(&admin, &PauseTier::SwapOnly);
        let unlock_time = c.get_unpause_unlock_time();

        c.unpause(&admin);

        env.ledger().with_mut(|l| l.timestamp = unlock_time + 1);
        c.execute_unpause();
    }

    #[test]
    #[should_panic(expected = "protocol is not paused")]
    fn test_unpause_when_not_paused_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, c) = setup_cb(&env);
        c.unpause(&admin);
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_unpause_by_non_admin_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, c) = setup_cb(&env);
        let rando = Address::generate(&env);

        c.trip(&admin, &PauseTier::All);
        c.unpause(&rando);
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_unpause_by_bot_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, c) = setup_cb(&env);
        let bot = Address::generate(&env);

        c.add_bot(&admin, &bot);
        c.trip(&bot, &PauseTier::All);

        // A bot may trip the breaker but must not be able to resume it.
        c.unpause(&bot);
    }

    #[test]
    fn test_pause_unpause_cycle_is_repeatable() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, c) = setup_cb(&env);

        for _ in 0..3 {
            c.trip(&admin, &PauseTier::All);
            assert!(c.is_paused());
            c.unpause(&admin);
            assert!(!c.is_paused());
        }

        // Each trip is still accounted for.
        assert_eq!(c.get_trip_count(), 3);
    }

    #[test]
    fn test_timelocked_unpause_to_lower_tier_keeps_is_paused_true() {
        let env = Env::default();
        env.mock_all_auths();
        let (admin, c) = setup_cb(&env);

        c.trip(&admin, &PauseTier::All);
        c.initiate_unpause(&admin, &PauseTier::SwapOnly);
        let unlock_time = c.get_unpause_unlock_time();
        env.ledger().with_mut(|l| l.timestamp = unlock_time + 1);
        c.execute_unpause();

        // Still paused, just at a narrower tier.
        assert_eq!(c.get_pause_tier(), PauseTier::SwapOnly);
        assert!(c.is_paused());
        assert!(c.is_swap_paused());
    }

    #[test]
    fn test_unpause_emits_resumed_event() {
        use soroban_sdk::{testutils::Events, vec as svec};

        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let id = env.register(CircuitBreaker, ());
        let c = CircuitBreakerClient::new(&env, &id);
        c.initialize(&admin, &oracle, &3600u64, &500i128);

        c.trip(&admin, &PauseTier::All);
        env.ledger().with_mut(|l| l.timestamp = 12_345);
        c.unpause(&admin);

        // `all()` reports the most recent invocation, i.e. the unpause call.
        // Topics: (cb, resumed); data: (admin, timestamp).
        assert_eq!(
            env.events().all(),
            svec![
                &env,
                (
                    id.clone(),
                    svec![
                        &env,
                        symbol_short!("cb").into_val(&env),
                        symbol_short!("resumed").into_val(&env),
                    ],
                    (admin.clone(), 12_345u64).into_val(&env),
                )
            ]
        );
    }

    // ── Volume spike detection & dynamic cooldown ─────────────────────────────

    /// Circuit breaker with a 100,000 baseline, so the default 300% spike
    /// threshold is 300,000 (well below the 1,000,000 absolute threshold).
    fn setup_spike(env: &Env) -> (Address, CircuitBreakerClient<'static>) {
        env.mock_all_auths();
        let (admin, c) = setup_cb(env);
        c.set_volume_baseline(&admin, &100_000i128);
        env.ledger().with_mut(|l| l.timestamp = 10_000);
        (admin, c)
    }

    #[test]
    fn test_spike_defaults() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, c) = setup_cb(&env);

        assert_eq!(c.get_volume_baseline(), 0);
        assert_eq!(c.get_spike_multiplier_bps(), DEFAULT_SPIKE_MULTIPLIER_BPS);
        assert_eq!(c.get_cooldown_until(), 0);
        assert!(!c.is_in_cooldown());
    }

    #[test]
    fn test_no_cooldown_without_baseline() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, c) = setup_cb(&env);

        c.record_volume(&900_000i128);
        assert!(!c.is_in_cooldown());
        assert!(!c.is_paused());
    }

    #[test]
    fn test_volume_at_spike_threshold_does_not_trigger_cooldown() {
        let env = Env::default();
        let (_, c) = setup_spike(&env);

        c.record_volume(&300_000i128);
        assert!(!c.is_in_cooldown());
        assert!(!c.is_paused());
        assert_eq!(c.get_pause_tier(), PauseTier::None);
    }

    #[test]
    fn test_volume_spike_triggers_two_hour_cooldown() {
        let env = Env::default();
        let (_, c) = setup_spike(&env);

        c.record_volume(&200_000i128);
        assert!(!c.is_in_cooldown());

        // Window total 300,001 > 300% of baseline.
        c.record_volume(&100_001i128);
        assert!(c.is_in_cooldown());
        assert_eq!(c.get_cooldown_until(), 10_000 + SPIKE_COOLDOWN_SECONDS);
        assert!(c.is_paused());
        assert!(c.is_all_paused());
        assert!(c.is_swap_paused());
        assert!(c.is_withdraw_paused());
        assert_eq!(c.get_pause_tier(), PauseTier::All);
        assert_eq!(c.get_trip_count(), 1);
    }

    #[test]
    fn test_cooldown_expires_automatically() {
        let env = Env::default();
        let (_, c) = setup_spike(&env);

        c.record_volume(&400_000i128);
        assert!(c.is_paused());

        env.ledger()
            .with_mut(|l| l.timestamp = 10_000 + SPIKE_COOLDOWN_SECONDS - 1);
        assert!(c.is_paused());

        env.ledger()
            .with_mut(|l| l.timestamp = 10_000 + SPIKE_COOLDOWN_SECONDS);
        assert!(!c.is_in_cooldown());
        assert!(!c.is_paused());
        assert_eq!(c.get_pause_tier(), PauseTier::None);
    }

    #[test]
    fn test_sustained_spike_extends_cooldown() {
        let env = Env::default();
        let (_, c) = setup_spike(&env);

        c.record_volume(&400_000i128);
        assert_eq!(c.get_cooldown_until(), 10_000 + SPIKE_COOLDOWN_SECONDS);

        // Still inside the same hourly window, volume keeps flowing.
        env.ledger().with_mut(|l| l.timestamp = 11_000);
        c.record_volume(&1i128);
        assert_eq!(c.get_cooldown_until(), 11_000 + SPIKE_COOLDOWN_SECONDS);
        // Extending an active cooldown is not a new trip.
        assert_eq!(c.get_trip_count(), 1);
    }

    #[test]
    fn test_spike_ages_out_of_window() {
        let env = Env::default();
        let (_, c) = setup_spike(&env);

        c.record_volume(&250_000i128);
        // An hour later the old entry is pruned, so no spike is detected.
        env.ledger()
            .with_mut(|l| l.timestamp = 10_000 + WINDOW_DURATION_SECONDS);
        c.record_volume(&250_000i128);
        assert_eq!(c.get_window_volume(), 250_000);
        assert!(!c.is_in_cooldown());
    }

    #[test]
    fn test_custom_spike_multiplier() {
        let env = Env::default();
        let (admin, c) = setup_spike(&env);

        // 150% of baseline.
        c.set_spike_multiplier_bps(&admin, &15_000i128);
        assert_eq!(c.get_spike_multiplier_bps(), 15_000);

        c.record_volume(&150_000i128);
        assert!(!c.is_in_cooldown());
        c.record_volume(&1i128);
        assert!(c.is_in_cooldown());
    }

    #[test]
    fn test_emergency_unpause_lifts_cooldown() {
        let env = Env::default();
        let (admin, c) = setup_spike(&env);

        c.record_volume(&400_000i128);
        assert!(c.is_paused());

        c.unpause(&admin);
        assert!(!c.is_in_cooldown());
        assert!(!c.is_paused());
        assert_eq!(c.get_cooldown_until(), 0);
    }

    #[test]
    fn test_cooldown_does_not_clear_governance_trip() {
        let env = Env::default();
        let (admin, c) = setup_spike(&env);

        c.trip(&admin, &PauseTier::SwapOnly);
        c.record_volume(&400_000i128);
        assert_eq!(c.get_pause_tier(), PauseTier::All);

        env.ledger()
            .with_mut(|l| l.timestamp = 10_000 + SPIKE_COOLDOWN_SECONDS);
        // Governance tier remains once the cooldown lapses.
        assert_eq!(c.get_pause_tier(), PauseTier::SwapOnly);
        assert!(c.is_paused());
    }

    #[test]
    fn test_disabling_baseline_stops_spike_detection() {
        let env = Env::default();
        let (admin, c) = setup_spike(&env);

        c.set_volume_baseline(&admin, &0i128);
        c.record_volume(&400_000i128);
        assert!(!c.is_in_cooldown());
    }

    #[test]
    #[should_panic(expected = "multiplier must exceed 10000 bps")]
    fn test_spike_multiplier_at_or_below_baseline_panics() {
        let env = Env::default();
        let (admin, c) = setup_spike(&env);
        c.set_spike_multiplier_bps(&admin, &10_000i128);
    }

    #[test]
    #[should_panic(expected = "baseline must not be negative")]
    fn test_negative_baseline_panics() {
        let env = Env::default();
        let (admin, c) = setup_spike(&env);
        c.set_volume_baseline(&admin, &-1i128);
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_set_volume_baseline_non_admin_panics() {
        let env = Env::default();
        let (_, c) = setup_spike(&env);
        c.set_volume_baseline(&Address::generate(&env), &1i128);
    }

    #[test]
    #[should_panic(expected = "caller is not admin")]
    fn test_set_spike_multiplier_non_admin_panics() {
        let env = Env::default();
        let (_, c) = setup_spike(&env);
        c.set_spike_multiplier_bps(&Address::generate(&env), &20_000i128);
    }
}
