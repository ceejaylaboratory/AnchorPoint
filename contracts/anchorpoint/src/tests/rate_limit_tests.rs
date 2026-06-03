//! DESIGN APPROACH: Option A — Per-action cooldown map
//! Rationale: Option A is preferred because it allows our tests to verify that distinct actions do not interfere with each other's execution schedules.

#![cfg(test)]

use crate::rate_limit::{ActionType, RateLimiter, RateLimitError};
use soroban_sdk::{Env, testutils::Ledger};

#[test]
fn test_happy_path() {
    let env = Env::default();
    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        env.ledger().set_timestamp(1000);
        
        // First-ever call (no stored timestamp): should always succeed
        assert_eq!(RateLimiter::check_and_update(&env, ActionType::UpdateOracle), Ok(()));
        
        // Action called, cooldown elapses (mock ledger time forward)
        // Default cooldown for UpdateOracle is 60 seconds
        let new_time = 1000u64.checked_add(61).unwrap();
        env.ledger().set_timestamp(new_time);
        
        // Action called again -> success
        assert_eq!(RateLimiter::check_and_update(&env, ActionType::UpdateOracle), Ok(()));
    });
}

#[test]
fn test_cooldown_active() {
    let env = Env::default();
    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        env.ledger().set_timestamp(1000);
        
        // First call succeeds
        assert_eq!(RateLimiter::check_and_update(&env, ActionType::UpdateOracle), Ok(()));
        
        // Action called twice without time advancing -> RateLimitError
        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::UpdateOracle),
            Err(RateLimitError::CooldownNotElapsed)
        );
        
        // Advance time, but less than the 60 second cooldown
        let new_time = 1000u64.checked_add(30).unwrap();
        env.ledger().set_timestamp(new_time);
        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::UpdateOracle),
            Err(RateLimitError::CooldownNotElapsed)
        );
    });
}

#[test]
fn test_per_action_independence() {
    let env = Env::default();
    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        env.ledger().set_timestamp(1000);
        
        // UpdateOracle succeeds and begins its 60-second cooldown
        assert_eq!(RateLimiter::check_and_update(&env, ActionType::UpdateOracle), Ok(()));
        
        // AddAsset should succeed immediately; it has its own separate cooldown
        assert_eq!(RateLimiter::check_and_update(&env, ActionType::AddAsset), Ok(()));
        
        // Attempting UpdateOracle again still fails
        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::UpdateOracle),
            Err(RateLimitError::CooldownNotElapsed)
        );
    });
}

#[test]
fn test_zero_cooldown_guard() {
    let env = Env::default();
    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        // Attempting to configure a zero cooldown -> error
        assert_eq!(
            RateLimiter::set_cooldown(&env, ActionType::UpdateOracle, 0),
            Err(RateLimitError::InvalidCooldown)
        );
        
        // Attempting to configure slightly below minimum -> error
        assert_eq!(
            RateLimiter::set_cooldown(&env, ActionType::UpdateOracle, RateLimiter::MIN_COOLDOWN.checked_sub(1).unwrap()),
            Err(RateLimitError::InvalidCooldown)
        );
        
        // Valid custom cooldown succeeds
        assert_eq!(
            RateLimiter::set_cooldown(&env, ActionType::UpdateOracle, 120),
            Ok(())
        );
    });
}

#[test]
fn test_timestamp_overflow() {
    let env = Env::default();
    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        let current_time = u64::MAX.checked_sub(10).unwrap();
        env.ledger().set_timestamp(current_time);
        
        // First call succeeds, saves timestamp near u64::MAX
        assert_eq!(RateLimiter::check_and_update(&env, ActionType::UpdateOracle), Ok(()));
        
        // Advance time slightly
        env.ledger().set_timestamp(current_time.checked_add(1).unwrap());
        
        // Next check evaluates: last.checked_add(cooldown) == (u64::MAX - 10) + 60 -> Overflow
        // Ledger timestamp near u64::MAX -> no panic, handles gracefully via checked_add
        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::UpdateOracle),
            Err(RateLimitError::TimestampOverflow)
        );
    });
}
