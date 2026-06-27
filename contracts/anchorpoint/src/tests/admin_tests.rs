//! Security tests for admin role constraints on sensitive protocol operations.

#![cfg(test)]

use crate::admin::Admin;
use crate::rate_limit::{ActionType, RateLimiter, RateLimitError};
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env};

#[test]
fn test_update_oracle_with_auth_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        env.ledger().set_timestamp(1000);
        assert_eq!(Admin::update_oracle(env.clone(), admin, 0, 100), Ok(()));
    });
}

#[test]
fn test_set_fee_with_auth_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        env.ledger().set_timestamp(1000);
        assert_eq!(Admin::set_fee(env.clone(), admin, 50), Ok(()));
    });
}

#[test]
#[should_panic]
fn test_update_oracle_without_auth_panics() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        let _ = Admin::update_oracle(env.clone(), admin, 0, 100);
    });
}

#[test]
#[should_panic]
fn test_set_fee_without_auth_panics() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        let _ = Admin::set_fee(env.clone(), admin, 50);
    });
}

#[test]
fn test_admin_action_blocked_during_cooldown_even_with_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        env.ledger().set_timestamp(1000);

        assert_eq!(Admin::update_oracle(env.clone(), admin, 0, 100), Ok(()));
        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::UpdateOracle),
            Err(RateLimitError::CooldownNotElapsed),
        );
    });
}

#[test]
fn test_set_fee_independent_of_update_oracle_cooldown() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        env.ledger().set_timestamp(1000);

        assert_eq!(Admin::update_oracle(env.clone(), admin, 0, 100), Ok(()));
        assert_eq!(RateLimiter::check_and_update(&env, ActionType::SetFee), Ok(()));
    });
}

#[test]
fn test_update_admin_has_24h_cooldown() {
    let env = Env::default();
    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        env.ledger().set_timestamp(1000);

        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::UpdateAdmin),
            Ok(()),
        );
        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::UpdateAdmin),
            Err(RateLimitError::CooldownNotElapsed),
        );

        let new_time = 1000u64.checked_add(86401).unwrap();
        env.ledger().set_timestamp(new_time);
        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::UpdateAdmin),
            Ok(()),
        );
    });
}

#[test]
fn test_set_fee_cooldown_independent_of_add_asset() {
    let env = Env::default();
    let contract_id = env.register(crate::AnchorPointContract, ());
    env.as_contract(&contract_id, || {
        env.ledger().set_timestamp(1000);

        assert_eq!(RateLimiter::check_and_update(&env, ActionType::AddAsset), Ok(()));
        assert_eq!(RateLimiter::check_and_update(&env, ActionType::SetFee), Ok(()));
    });
}
