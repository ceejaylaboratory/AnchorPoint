//! Shared storage TTL policy for every AnchorPoint contract.
//!
//! Contracts must extend storage TTLs through these helpers instead of calling
//! `extend_ttl` inline, so that the whole workspace follows one documented
//! policy:
//!
//! * When an entry has fewer than [`TTL_THRESHOLD`] ledgers left to live, it is
//!   extended so that it lives for [`TTL_EXTENSION`] ledgers from now.
//! * Entries whose lifetime is part of the contract's semantics (e.g. a replay
//!   window or a lock timeout) use the `*_with` variants, which take an
//!   explicit `(threshold, extend_to)` pair but still route through this
//!   module.
use soroban_sdk::{Env, IntoVal, Val};

/// Number of ledgers per day, assuming ~5 seconds per ledger.
pub const LEDGERS_PER_DAY: u32 = 17_280;

/// Extend an entry once its remaining TTL drops below 7 days (120,960 ledgers).
pub const TTL_THRESHOLD: u32 = 7 * LEDGERS_PER_DAY;

/// Extend an entry so it lives for 30 days (518,400 ledgers) from now.
pub const TTL_EXTENSION: u32 = 30 * LEDGERS_PER_DAY;

/// Extend the current contract's instance storage using the shared policy.
pub fn extend_instance_ttl(env: &Env) {
    extend_instance_ttl_with(env, TTL_THRESHOLD, TTL_EXTENSION);
}

/// Extend a persistent entry using the shared policy.
pub fn extend_persistent_ttl<K>(env: &Env, key: &K)
where
    K: IntoVal<Env, Val>,
{
    extend_persistent_ttl_with(env, key, TTL_THRESHOLD, TTL_EXTENSION);
}

/// Extend a temporary entry using the shared policy.
pub fn extend_temp_ttl<K>(env: &Env, key: &K)
where
    K: IntoVal<Env, Val>,
{
    extend_temp_ttl_with(env, key, TTL_THRESHOLD, TTL_EXTENSION);
}

/// Extend instance storage with an explicit `(threshold, extend_to)` policy.
pub fn extend_instance_ttl_with(env: &Env, threshold: u32, extend_to: u32) {
    env.storage().instance().extend_ttl(threshold, extend_to);
}

/// Extend a persistent entry with an explicit `(threshold, extend_to)` policy.
pub fn extend_persistent_ttl_with<K>(env: &Env, key: &K, threshold: u32, extend_to: u32)
where
    K: IntoVal<Env, Val>,
{
    env.storage().persistent().extend_ttl(key, threshold, extend_to);
}

/// Extend a temporary entry with an explicit `(threshold, extend_to)` policy.
pub fn extend_temp_ttl_with<K>(env: &Env, key: &K, threshold: u32, extend_to: u32)
where
    K: IntoVal<Env, Val>,
{
    env.storage().temporary().extend_ttl(key, threshold, extend_to);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl, symbol_short,
        testutils::{
            storage::{Instance as _, Persistent as _, Temporary as _},
            Ledger as _,
        },
        Env,
    };

    #[contract]
    struct TtlTestContract;

    #[contractimpl]
    impl TtlTestContract {}

    fn setup() -> (Env, soroban_sdk::Address) {
        let env = Env::default();
        // Allow extensions up to the shared policy in tests.
        env.ledger().with_mut(|l| {
            l.min_persistent_entry_ttl = 16;
            l.min_temp_entry_ttl = 16;
            l.max_entry_ttl = TTL_EXTENSION + 1;
        });
        let id = env.register(TtlTestContract, ());
        (env, id)
    }

    #[test]
    fn policy_constants_are_consistent() {
        assert_eq!(TTL_THRESHOLD, 120_960);
        assert_eq!(TTL_EXTENSION, 518_400);
        assert!(TTL_THRESHOLD < TTL_EXTENSION);
    }

    #[test]
    fn extend_instance_ttl_applies_shared_policy() {
        let (env, id) = setup();
        env.as_contract(&id, || {
            env.storage().instance().set(&symbol_short!("k"), &1u32);
            assert!(env.storage().instance().get_ttl() < TTL_THRESHOLD);
            extend_instance_ttl(&env);
            assert_eq!(env.storage().instance().get_ttl(), TTL_EXTENSION);
        });
    }

    #[test]
    fn extend_persistent_ttl_applies_shared_policy() {
        let (env, id) = setup();
        let key = symbol_short!("p");
        env.as_contract(&id, || {
            env.storage().persistent().set(&key, &1u32);
            assert!(env.storage().persistent().get_ttl(&key) < TTL_THRESHOLD);
            extend_persistent_ttl(&env, &key);
            assert_eq!(env.storage().persistent().get_ttl(&key), TTL_EXTENSION);
        });
    }

    #[test]
    fn extend_temp_ttl_applies_shared_policy() {
        let (env, id) = setup();
        let key = symbol_short!("t");
        env.as_contract(&id, || {
            env.storage().temporary().set(&key, &1u32);
            assert!(env.storage().temporary().get_ttl(&key) < TTL_THRESHOLD);
            extend_temp_ttl(&env, &key);
            assert_eq!(env.storage().temporary().get_ttl(&key), TTL_EXTENSION);
        });
    }

    #[test]
    fn extension_is_skipped_above_threshold() {
        let (env, id) = setup();
        let key = symbol_short!("p");
        env.as_contract(&id, || {
            env.storage().persistent().set(&key, &1u32);
            extend_persistent_ttl_with(&env, &key, 100, 1_000);
            assert_eq!(env.storage().persistent().get_ttl(&key), 1_000);
            // Remaining TTL (1_000) is above the threshold (500): no change.
            extend_persistent_ttl_with(&env, &key, 500, 5_000);
            assert_eq!(env.storage().persistent().get_ttl(&key), 1_000);
        });
    }

    #[test]
    fn with_variants_apply_custom_policy() {
        let (env, id) = setup();
        let key = symbol_short!("t");
        env.as_contract(&id, || {
            env.storage().instance().set(&key, &1u32);
            env.storage().temporary().set(&key, &1u32);
            extend_instance_ttl_with(&env, 1_000, 2_000);
            extend_temp_ttl_with(&env, &key, 1_000, 3_000);
            assert_eq!(env.storage().instance().get_ttl(), 2_000);
            assert_eq!(env.storage().temporary().get_ttl(&key), 3_000);
        });
    }
}
