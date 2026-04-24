#![no_std]
//! Balance Snapshot Module for Fair Reward Distribution
//!
//! Implements a checkpoint-based snapshot mechanism that records each user's
//! staked balance at discrete epochs. Rewards are distributed proportionally
//! based on the balance held at the snapshot epoch, preventing manipulation
//! by staking just before a reward drop and unstaking immediately after.
//!
//! ## Storage layout (gas-efficient)
//!
//! - `SnapshotEpoch`               → current epoch counter (instance)
//! - `TotalStaked`                 → live total staked (instance)
//! - `EpochTotal(epoch)`           → total staked frozen at a past epoch (persistent)
//! - `UserCheckpoint(user, epoch)` → user balance written at a specific epoch (persistent)
//! - `UserLastEpoch(user)`         → last epoch a user wrote a checkpoint (persistent)
//!
//! Only a new checkpoint is written when a user's balance actually changes,
//! keeping per-user storage O(interactions), not O(epochs).

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

// Persistent entries live for ~30 days by default on Soroban; bump on every
// write so active data never expires unexpectedly.
const LEDGERS_PER_DAY: u32 = 17_280; // ~5 s per ledger
const TTL_BUMP: u32 = 60 * LEDGERS_PER_DAY; // 60 days

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Monotonically increasing epoch counter.
    SnapshotEpoch,
    /// Live total staked (updated on every stake/unstake).
    TotalStaked,
    /// Snapshot of total staked frozen at a closed epoch.
    EpochTotal(u32),
    /// User balance checkpoint: written when balance changes at `epoch`.
    UserCheckpoint(Address, u32),
    /// Most recent epoch at which a user wrote a checkpoint.
    UserLastEpoch(Address),
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SnapshotStaking;

#[contractimpl]
impl SnapshotStaking {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    /// Initialise the contract. Must be called once before any other function.
    pub fn initialize(env: Env) {
        if env.storage().instance().has(&DataKey::SnapshotEpoch) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::SnapshotEpoch, &0_u32);
        env.storage().instance().set(&DataKey::TotalStaked, &0_i128);
    }

    /// Advance to the next epoch and freeze the current total staked.
    ///
    /// Should be called by a keeper / cron job before distributing rewards.
    /// O(1) — no iteration.
    pub fn advance_epoch(env: Env) -> u32 {
        let epoch = Self::current_epoch(env.clone());

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);

        let key = DataKey::EpochTotal(epoch);
        env.storage().persistent().set(&key, &total);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_BUMP, TTL_BUMP);

        let next = epoch + 1;
        env.storage()
            .instance()
            .set(&DataKey::SnapshotEpoch, &next);

        env.events().publish((symbol_short!("new_epoch"),), next);

        next
    }

    // ── Staking ───────────────────────────────────────────────────────────

    /// Record a stake of `amount` for `user` at the current epoch.
    pub fn stake(env: Env, user: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let epoch = Self::current_epoch(env.clone());
        let prev = Self::_balance_at_epoch(&env, &user, epoch);
        Self::_write_checkpoint(&env, &user, epoch, prev + amount);

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &(total + amount));

        env.events()
            .publish((symbol_short!("staked"), user), amount);
    }

    /// Record an unstake of `amount` for `user` at the current epoch.
    pub fn unstake(env: Env, user: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let epoch = Self::current_epoch(env.clone());
        let prev = Self::_balance_at_epoch(&env, &user, epoch);
        assert!(prev >= amount, "insufficient stake");

        Self::_write_checkpoint(&env, &user, epoch, prev - amount);

        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalStaked)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalStaked, &(total - amount));

        env.events()
            .publish((symbol_short!("unstaked"), user), amount);
    }

    // ── Views ─────────────────────────────────────────────────────────────

    /// Current (live) epoch index.
    pub fn current_epoch(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SnapshotEpoch)
            .unwrap_or(0)
    }

    /// Total staked frozen at `epoch` (after `advance_epoch` was called for it).
    pub fn epoch_total(env: Env, epoch: u32) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::EpochTotal(epoch))
            .unwrap_or(0)
    }

    /// User's balance as it was recorded at `epoch`.
    ///
    /// Returns the most recent checkpoint written at or before `epoch`.
    pub fn balance_at(env: Env, user: Address, epoch: u32) -> i128 {
        Self::_balance_at_epoch(&env, &user, epoch)
    }

    /// Reward share in basis points (0–10_000) for `user` at `epoch`.
    ///
    /// `share_bps = user_balance * 10_000 / epoch_total`
    ///
    /// Returns 0 if total staked was 0 at that epoch.
    pub fn reward_share_bps(env: Env, user: Address, epoch: u32) -> u32 {
        let total = Self::epoch_total(env.clone(), epoch);
        if total == 0 {
            return 0;
        }
        let user_bal = Self::balance_at(env, user, epoch);
        ((user_bal * 10_000) / total) as u32
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    /// Write a checkpoint for `user` at `epoch` and bump its TTL.
    fn _write_checkpoint(env: &Env, user: &Address, epoch: u32, balance: i128) {
        let ck_key = DataKey::UserCheckpoint(user.clone(), epoch);
        env.storage().persistent().set(&ck_key, &balance);
        env.storage()
            .persistent()
            .extend_ttl(&ck_key, TTL_BUMP, TTL_BUMP);

        let le_key = DataKey::UserLastEpoch(user.clone());
        env.storage().persistent().set(&le_key, &epoch);
        env.storage()
            .persistent()
            .extend_ttl(&le_key, TTL_BUMP, TTL_BUMP);
    }

    /// Resolve a user's balance at `epoch`.
    ///
    /// 1. Exact match: checkpoint written at exactly `epoch`.
    /// 2. Carry-forward: use the checkpoint from `UserLastEpoch` when that
    ///    epoch ≤ `epoch` (balance unchanged since last interaction).
    /// 3. No prior stake: return 0.
    fn _balance_at_epoch(env: &Env, user: &Address, epoch: u32) -> i128 {
        // Fast path: exact checkpoint for this epoch
        if let Some(bal) = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::UserCheckpoint(user.clone(), epoch))
        {
            return bal;
        }

        // Carry-forward: find the last epoch the user interacted
        let last_epoch: Option<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::UserLastEpoch(user.clone()));

        match last_epoch {
            // User has never staked
            None => 0,
            Some(le) if le > epoch => {
                // User's most recent interaction is after `epoch` — they had
                // no stake at `epoch` (or we can't know; conservatively 0).
                0
            }
            Some(le) => {
                // le <= epoch: carry the balance from that checkpoint forward
                env.storage()
                    .persistent()
                    .get(&DataKey::UserCheckpoint(user.clone(), le))
                    .unwrap_or(0)
            }
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, SnapshotStakingClient<'static>, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(SnapshotStaking, ());
        let client = SnapshotStakingClient::new(&env, &id);
        client.initialize();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        (env, client, alice, bob)
    }

    #[test]
    fn test_stake_and_snapshot() {
        let (_env, client, alice, _bob) = setup();

        client.stake(&alice, &1_000);
        assert_eq!(client.balance_at(&alice, &0), 1_000);

        let next = client.advance_epoch();
        assert_eq!(next, 1);
        assert_eq!(client.epoch_total(&0), 1_000);
        assert_eq!(client.balance_at(&alice, &0), 1_000);
    }

    #[test]
    fn test_reward_share_proportional() {
        let (_env, client, alice, bob) = setup();

        client.stake(&alice, &300);
        client.stake(&bob, &700);
        client.advance_epoch(); // closes epoch 0

        assert_eq!(client.reward_share_bps(&alice, &0), 3_000);
        assert_eq!(client.reward_share_bps(&bob, &0), 7_000);
    }

    #[test]
    fn test_late_staker_excluded_from_past_epoch() {
        let (_env, client, alice, bob) = setup();

        client.stake(&alice, &1_000);
        client.advance_epoch(); // closes epoch 0

        // Bob stakes in epoch 1 — must have 0 share in epoch 0
        client.stake(&bob, &1_000);
        assert_eq!(client.reward_share_bps(&bob, &0), 0);
        assert_eq!(client.reward_share_bps(&alice, &0), 10_000);
    }

    #[test]
    fn test_unstake_reduces_balance() {
        let (_env, client, alice, _bob) = setup();

        client.stake(&alice, &1_000);
        client.unstake(&alice, &400);
        assert_eq!(client.balance_at(&alice, &0), 600);
    }

    #[test]
    #[should_panic(expected = "insufficient stake")]
    fn test_unstake_exceeds_balance_panics() {
        let (_env, client, alice, _bob) = setup();
        client.stake(&alice, &100);
        client.unstake(&alice, &200);
    }

    #[test]
    fn test_balance_carries_forward_across_epochs() {
        let (_env, client, alice, _bob) = setup();

        client.stake(&alice, &500);
        client.advance_epoch(); // 0 → 1
        client.advance_epoch(); // 1 → 2

        // Alice never interacted in epochs 1 or 2; balance carries forward
        assert_eq!(client.balance_at(&alice, &1), 500);
        assert_eq!(client.balance_at(&alice, &2), 500);
    }

    #[test]
    fn test_epoch_total_zero_when_no_stakers() {
        let (_env, client, alice, _bob) = setup();
        client.advance_epoch();
        assert_eq!(client.epoch_total(&0), 0);
        assert_eq!(client.reward_share_bps(&alice, &0), 0);
    }

    #[test]
    fn test_never_staked_user_returns_zero() {
        let (env, client, _alice, _bob) = setup();
        let carol = Address::generate(&env);
        client.advance_epoch();
        assert_eq!(client.balance_at(&carol, &0), 0);
        assert_eq!(client.reward_share_bps(&carol, &0), 0);
    }

    #[test]
    fn test_double_initialize_panics() {
        let (_env, client, _alice, _bob) = setup();
        // setup() already called initialize(); calling again must panic
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.initialize();
        }));
        assert!(result.is_err());
    }
}
