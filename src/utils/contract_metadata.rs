//! Reusable contract metadata module.
//!
//! Provides a `ContractMetadata` struct (description, icon_url, website) and
//! helper functions to read/write it from any Soroban contract's instance
//! storage. Metadata is stored under a caller-supplied key so it never
//! conflicts with the host contract's own storage layout.
//!
//! # Usage
//! ```ignore
//! // In your DataKey enum:
//! ContractMeta,
//!
//! // In initialize():
//! contract_metadata::init(&env, &DataKey::ContractMeta);
//!
//! // Admin-only update:
//! contract_metadata::update(&env, &DataKey::ContractMeta, &admin, description, icon_url, website);
//!
//! // Public read:
//! let meta = contract_metadata::get(&env, &DataKey::ContractMeta);
//! ```

use soroban_sdk::{symbol_short, Address, Env, IntoVal, String, TryFromVal, Val};

/// On-chain branding / project metadata for a contract.
///
/// All fields are optional in the sense that they may be empty strings;
/// the struct is always present after `init` is called.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractMetadata {
    /// Human-readable description of the contract's purpose.
    pub description: String,
    /// URL pointing to the project's icon / logo image.
    pub icon_url: String,
    /// Project or protocol website URL.
    pub website: String,
}

/// Initialise metadata with empty strings.
///
/// Must be called once during the contract's `initialize` function.
/// Subsequent calls are no-ops (idempotent).
pub fn init<K>(env: &Env, key: &K)
where
    K: IntoVal<Env, Val> + TryFromVal<Env, Val>,
{
    if !env.storage().instance().has(key) {
        env.storage().instance().set(key, &ContractMetadata {
            description: String::from_str(env, ""),
            icon_url: String::from_str(env, ""),
            website: String::from_str(env, ""),
        });
    }
}

/// Return the current contract metadata.
///
/// # Panics
/// Panics if `init` was never called (metadata not found).
pub fn get<K>(env: &Env, key: &K) -> ContractMetadata
where
    K: IntoVal<Env, Val> + TryFromVal<Env, Val>,
{
    env.storage()
        .instance()
        .get(key)
        .expect("contract metadata not initialised")
}

/// Replace the contract metadata (admin-only).
///
/// The caller must be the contract admin; `admin.require_auth()` is called
/// internally so the transaction will fail if the signature is absent.
///
/// # Arguments
/// * `env`         – Soroban environment
/// * `key`         – Storage key used by the host contract for metadata
/// * `admin`       – Admin address (must sign the transaction)
/// * `description` – New description (pass current value to leave unchanged)
/// * `icon_url`    – New icon URL
/// * `website`     – New website URL
pub fn update<K>(
    env: &Env,
    key: &K,
    admin: &Address,
    description: String,
    icon_url: String,
    website: String,
) where
    K: IntoVal<Env, Val> + TryFromVal<Env, Val>,
{
    admin.require_auth();

    let meta = ContractMetadata { description, icon_url, website };
    env.storage().instance().set(key, &meta);

    env.events().publish((symbol_short!("meta_upd"),), meta);
}
