use soroban_sdk::{Env, IntoVal, Val};

/// Default threshold: 7 days in ledgers (assuming ~5 seconds per ledger).
pub const INSTANCE_THRESHOLD: u32 = 7 * 17_280; // 120,960 ledgers

/// Default extension target: 30 days in ledgers (assuming ~5 seconds per ledger).
pub const INSTANCE_EXTEND_TO: u32 = 30 * 17_280; // 518,400 ledgers

/// Extend the TTL of the current contract instance storage if it is below the threshold.
///
/// # Arguments
/// * `env` - The contract environment.
/// * `threshold` - The minimum number of ledgers remaining before extension is triggered.
/// * `extend_to` - The new TTL (in ledgers) to extend to.
pub fn extend_instance_ttl(env: &Env, threshold: u32, extend_to: u32) {
    env.storage().instance().extend_ttl(threshold, extend_to);
}

/// Extend a persistent entry using the shared TTL policy supplied by the caller.
pub fn extend_persistent_ttl<K>(env: &Env, key: &K, threshold: u32, extend_to: u32)
where
    K: IntoVal<Env, Val>,
{
    env.storage().persistent().extend_ttl(key, threshold, extend_to);
}

/// Extend a temporary entry using the shared TTL policy supplied by the caller.
pub fn extend_temporary_ttl<K>(env: &Env, key: &K, threshold: u32, extend_to: u32)
where
    K: IntoVal<Env, Val>,
{
    env.storage().temporary().extend_ttl(key, threshold, extend_to);
}
