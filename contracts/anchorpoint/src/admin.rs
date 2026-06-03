//! DESIGN APPROACH: Option A — Per-action cooldown map
//! Rationale: In an admin context, separating cooldowns ensures emergency functions remain available even if regular maintenance functions were just called.

use crate::rate_limit::{ActionType, RateLimiter, RateLimitError};
use soroban_sdk::{Env, Address};

/// Admin module wrapper.
/// Contains the sensitive protocol operations that require rate limiting.
pub struct Admin;

impl Admin {
    pub fn update_oracle(env: Env, admin: Address, _feed_id: u32, _price: i128) -> Result<(), RateLimitError> {
        admin.require_auth();
        
        // Security: Admin key compromise during lockout
        // If the cooldown is active and the admin key is compromised, the attacker must still wait out 
        // the cooldown. This provides an essential time window to intervene.
        RateLimiter::check_and_update(&env, ActionType::UpdateOracle)?;
        
        // ... oracle updating logic ...
        Ok(())
    }

    pub fn set_fee(env: Env, admin: Address, _new_fee: u32) -> Result<(), RateLimitError> {
        admin.require_auth();
        
        // Independent action cooldown allows setting fees even if the oracle was just updated.
        RateLimiter::check_and_update(&env, ActionType::SetFee)?;
        
        // ... fee setting logic ...
        Ok(())
    }
}
