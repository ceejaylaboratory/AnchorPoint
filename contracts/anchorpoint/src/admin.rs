//! Administrative module for AnchorPoint contract.
//! Handles sensitive protocol operations, fee updates, parameter changes, and rate limiting.

use crate::events;
use crate::rate_limit::{ActionType, RateLimitError, RateLimiter};
use crate::storage_keys::{DataKey, FeeConfig};
use crate::Error;
use soroban_sdk::{Address, Env};

/// Admin module wrapper.
/// Contains sensitive protocol operations that require authorization and rate limiting.
pub struct Admin;

impl Admin {
    /// Internal helper to verify that the caller is the authorized admin.
    /// If no admin is configured yet, the first caller is set as the admin.
    fn check_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let stored_admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        match stored_admin {
            Some(ref admin) => {
                if caller != admin {
                    return Err(Error::Unauthorized);
                }
            }
            None => {
                env.storage().instance().set(&DataKey::Admin, caller);
            }
        }
        Ok(())
    }

    /// Updates the oracle feed price with authorization and rate limiting.
    pub fn update_oracle(
        env: Env,
        admin: Address,
        _feed_id: u32,
        _price: i128,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::check_admin(&env, &admin)?;

        // Security: Admin key compromise during lockout
        // If the cooldown is active and the admin key is compromised, the attacker must still wait out
        // the cooldown. This provides an essential time window to intervene.
        RateLimiter::check_and_update(&env, ActionType::UpdateOracle)
            .map_err(|_: RateLimitError| Error::Unauthorized)?;

        // ... oracle updating logic ...
        Ok(())
    }

    /// Sets a generic fee percentage, enforcing rate limiting and emitting a `FeeUpdated` event.
    pub fn set_fee(env: Env, admin: Address, new_fee: u32) -> Result<(), Error> {
        admin.require_auth();
        Self::check_admin(&env, &admin)?;

        // Independent action cooldown allows setting fees even if the oracle was just updated.
        RateLimiter::check_and_update(&env, ActionType::SetFee)
            .map_err(|_: RateLimitError| Error::Unauthorized)?;

        let fee_config = FeeConfig {
            base_fee: 0,
            rate: new_fee,
        };
        env.storage()
            .instance()
            .set(&DataKey::Fee(admin.clone()), &fee_config);

        // Emit typed FeeUpdated contract event
        events::emit_fee_updated(&env, &admin, 0, new_fee);

        Ok(())
    }

    /// Updates fee parameters (base_fee and rate) for a specific asset and emits a `FeeUpdated` event.
    pub fn update_fee(
        env: Env,
        admin: Address,
        asset: Address,
        base_fee: i128,
        rate: u32,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::check_admin(&env, &admin)?;

        if base_fee < 0 {
            return Err(Error::InvalidAmount);
        }

        RateLimiter::check_and_update(&env, ActionType::SetFee)
            .map_err(|_: RateLimitError| Error::Unauthorized)?;

        let fee_config = FeeConfig { base_fee, rate };
        env.storage()
            .instance()
            .set(&DataKey::Fee(asset.clone()), &fee_config);

        // Emit typed FeeUpdated contract event
        events::emit_fee_updated(&env, &asset, base_fee, rate);

        Ok(())
    }

    /// Updates the protocol administrator, enforces the 24-hour rate limit cooldown,
    /// and emits an `AdminChanged` event.
    pub fn set_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), Error> {
        current_admin.require_auth();
        Self::check_admin(&env, &current_admin)?;

        RateLimiter::check_and_update(&env, ActionType::UpdateAdmin)
            .map_err(|_: RateLimitError| Error::Unauthorized)?;

        let old_admin = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| current_admin.clone());

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        // Emit typed AdminChanged contract event
        events::emit_admin_changed(&env, &old_admin, &new_admin);

        Ok(())
    }

    /// Pauses contract operations and emits a `ContractPaused` event.
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::check_admin(&env, &admin)?;

        env.storage().instance().set(&DataKey::Paused, &true);

        // Emit typed ContractPaused contract event
        events::emit_contract_paused(&env);

        Ok(())
    }

    /// Unpauses contract operations and emits a `ContractUnpaused` event.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::check_admin(&env, &admin)?;

        env.storage().instance().set(&DataKey::Paused, &false);

        // Emit typed ContractUnpaused contract event
        events::emit_contract_unpaused(&env);

        Ok(())
    }

    /// Updates the authorized relayer address and emits a `RelayerChanged` event.
    pub fn set_relayer(env: Env, admin: Address, new_relayer: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::check_admin(&env, &admin)?;

        let old_relayer = env
            .storage()
            .instance()
            .get(&DataKey::Relayer)
            .unwrap_or_else(|| admin.clone());

        env.storage()
            .instance()
            .set(&DataKey::Relayer, &new_relayer);

        // Emit typed RelayerChanged contract event
        events::emit_relayer_changed(&env, &old_relayer, &new_relayer);

        Ok(())
    }

    /// Retrieves the current admin address if set.
    pub fn get_admin(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    /// Returns true if the contract is currently paused.
    pub fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Retrieves the authorized relayer address if set.
    pub fn get_relayer(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Relayer)
    }

    /// Retrieves the fee configuration for a specific asset.
    pub fn get_fee(env: &Env, asset: Address) -> Option<FeeConfig> {
        env.storage().instance().get(&DataKey::Fee(asset))
    }
}
