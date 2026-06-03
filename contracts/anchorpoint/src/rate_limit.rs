//! DESIGN APPROACH: Option A — Per-action cooldown map
//! Rationale: A global cooldown is too restrictive in a multi-functional system. During periods of volatility, an admin may need to update an oracle feed and immediately after update fees or pause an asset. Option A allows independent operational pathways without artificial contention.

use soroban_sdk::{contracterror, contracttype, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RateLimitError {
    /// The cooldown period has not yet elapsed for this action.
    CooldownNotElapsed = 1,
    /// An invalid cooldown duration (e.g., zero) was configured.
    InvalidCooldown = 2,
    /// Timestamp math overflowed.
    TimestampOverflow = 3,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionType {
    AddAsset = 1,
    UpdateOracle = 2,
    SetFee = 3,
    RemoveAsset = 4,
    UpdateAdmin = 5,
}

pub struct RateLimiter;

impl RateLimiter {
    /// Minimum allowed cooldown in seconds to prevent disabling rate limiting.
    pub const MIN_COOLDOWN: u64 = 10;

    /// Checks if the cooldown has elapsed for the given action and updates the timestamp if successful.
    pub fn check_and_update(env: &Env, action: ActionType) -> Result<(), RateLimitError> {
        let current_time = env.ledger().timestamp();
        let last_called = Self::get_last_called(env, action.clone());
        let cooldown = Self::get_cooldown(env, action.clone());

        if let Some(last) = last_called {
            // Security: Integer overflow on timestamp arithmetic
            // We use checked_add to ensure that a malicious or corrupted timestamp does not wrap around.
            let next_allowed_time = last.checked_add(cooldown).ok_or(RateLimitError::TimestampOverflow)?;
            
            // Security: Timestamp manipulation
            // Validators provide timestamps via consensus. A drift of ±N seconds is acceptable 
            // because rate-limiting is designed to prevent rapid succession spam, not to act as a precision clock.
            if current_time < next_allowed_time {
                return Err(RateLimitError::CooldownNotElapsed);
            }
        }

        // Update the timestamp to the current ledger time.
        env.storage().instance().set(&crate::storage_keys::DataKey::ActionCooldown(action), &current_time);
        
        Ok(())
    }

    /// Retrieves the last called timestamp for a given action.
    pub fn get_last_called(env: &Env, action: ActionType) -> Option<u64> {
        env.storage().instance().get(&crate::storage_keys::DataKey::ActionCooldown(action))
    }

    /// Sets a new cooldown duration for a specific action.
    pub fn set_cooldown(env: &Env, action: ActionType, cooldown: u64) -> Result<(), RateLimitError> {
        // Security: Cooldown misconfiguration
        // We guard against a cooldown of zero (or any value below MIN_COOLDOWN) being set, 
        // ensuring rate limiting cannot be effectively disabled.
        if cooldown < Self::MIN_COOLDOWN {
            return Err(RateLimitError::InvalidCooldown);
        }
        
        env.storage().instance().set(&crate::storage_keys::DataKey::ActionCooldownDuration(action), &cooldown);
        Ok(())
    }

    /// Returns the cooldown duration in seconds for a given action.
    pub fn get_cooldown(env: &Env, action: ActionType) -> u64 {
        env.storage()
            .instance()
            .get(&crate::storage_keys::DataKey::ActionCooldownDuration(action.clone()))
            .unwrap_or_else(|| match action {
                ActionType::AddAsset => 3600,      // 1 hour
                ActionType::UpdateOracle => 60,    // 1 minute
                ActionType::SetFee => 1800,        // 30 minutes
                ActionType::RemoveAsset => 86400,  // 24 hours
                ActionType::UpdateAdmin => 86400,  // 24 hours
            })
    }
}
