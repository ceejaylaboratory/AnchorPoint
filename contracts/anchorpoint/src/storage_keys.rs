//! Storage keys and configurations for the AnchorPoint contract.

use crate::rate_limit::ActionType;
use soroban_sdk::{contracttype, Address};

/// Configuration for asset fees.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub base_fee: i128,
    pub rate: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Contract administrator address.
    Admin,
    /// General configuration key.
    Config,
    /// Whether the contract is paused.
    Paused,
    /// Authorized relayer address.
    Relayer,
    /// Fee configuration for a specific asset.
    Fee(Address),

    /// Tracks the last execution timestamp for rate-limited admin actions.
    /// Security: Cooldown bypass via action aliasing
    /// The `ActionType` inner value ensures namespace isolation. Soroban deterministically
    /// serializes this enum via XDR, making it mathematically impossible for two different
    /// actions to share the same storage key.
    ActionCooldown(ActionType),

    /// Tracks the configured cooldown duration for a specific action.
    ActionCooldownDuration(ActionType),
}
