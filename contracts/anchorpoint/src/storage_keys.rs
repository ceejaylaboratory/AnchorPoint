//! DESIGN APPROACH: Option A — Per-action cooldown map
//! Rationale: By using an ActionType enum within our DataKey, we isolate the storage slots for different actions, preventing collision and ensuring independence.

use soroban_sdk::contracttype;
use crate::rate_limit::ActionType;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Config,
    
    /// Tracks the last execution timestamp for rate-limited admin actions.
    /// Security: Cooldown bypass via action aliasing
    /// The `ActionType` inner value ensures namespace isolation. Soroban deterministically 
    /// serializes this enum via XDR, making it mathematically impossible for two different 
    /// actions to share the same storage key.
    ActionCooldown(ActionType),
    
    /// Tracks the configured cooldown duration for a specific action.
    ActionCooldownDuration(ActionType),
}
