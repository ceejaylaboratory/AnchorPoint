//! Security tests for admin role constraints on sensitive protocol operations and event emissions.

#![cfg(test)]

use crate::admin::Admin;
use crate::events::{
    AdminChanged, ContractPaused, ContractUnpaused, FeeUpdated, RelayerChanged,
    TOPIC_ADMIN_CHANGED, TOPIC_CONTRACT_PAUSED, TOPIC_CONTRACT_UNPAUSED, TOPIC_FEE_UPDATED,
    TOPIC_RELAYER_CHANGED,
};
use crate::rate_limit::{ActionType, RateLimitError, RateLimiter};
use crate::Error;
use soroban_sdk::{
    testutils::Address as _, testutils::Events, testutils::Ledger, vec, Address, Env, IntoVal,
    TryFromVal,
};

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
        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::SetFee),
            Ok(())
        );
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

        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::AddAsset),
            Ok(())
        );
        assert_eq!(
            RateLimiter::check_and_update(&env, ActionType::SetFee),
            Ok(())
        );
    });
}

// -------------------------------------------------------------------------
// Error enum tests (#808)
// -------------------------------------------------------------------------

#[test]
fn test_error_codes_are_distinct_u32() {
    // Each variant must map to a unique non-zero u32.
    assert_eq!(Error::Unauthorized as u32, 1);
    assert_eq!(Error::AlreadyInitialized as u32, 2);
    assert_eq!(Error::InvalidAmount as u32, 3);
    assert_eq!(Error::InsufficientBalance as u32, 4);
    assert_eq!(Error::InsufficientAllowance as u32, 5);
    assert_eq!(Error::SupplyCapExceeded as u32, 6);
    assert_eq!(Error::ContractPaused as u32, 7);
    assert_eq!(Error::NotInitialized as u32, 8);
    assert_eq!(Error::BatchTooLarge as u32, 9);
    assert_eq!(Error::EmptyBatch as u32, 10);
}

#[test]
fn test_admin_rate_limit_returns_error_enum() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    env.ledger().set_timestamp(1000);
    env.as_contract(&contract_id, || {
        // First call succeeds → Ok(())
        assert_eq!(
            Admin::update_oracle(env.clone(), admin.clone(), 0, 100),
            Ok(())
        );
    });
    env.as_contract(&contract_id, || {
        // Second call within cooldown → Err(Error::Unauthorized)
        assert_eq!(
            Admin::update_oracle(env.clone(), admin.clone(), 0, 200),
            Err(Error::Unauthorized),
        );
    });
}

// -------------------------------------------------------------------------
// Event Emission Unit Tests (#1644)
// -------------------------------------------------------------------------

#[test]
fn test_set_admin_emits_admin_changed_event() {
    let env = Env::default();
    env.mock_all_auths();
    let old_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    let client = crate::AnchorPointContractClient::new(&env, &contract_id);
    env.ledger().set_timestamp(1000);

    let events_before = env.events().all().len();
    client.set_admin(&old_admin, &new_admin);
    let events_after = env.events().all().len();
    assert_eq!(events_after, events_before + 1);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(last_event.1, vec![&env, TOPIC_ADMIN_CHANGED.into_val(&env)]);

    let payload = AdminChanged::try_from_val(&env, &last_event.2).unwrap();
    assert_eq!(
        payload,
        AdminChanged {
            old_admin: old_admin.clone(),
            new_admin: new_admin.clone(),
        }
    );
    assert_eq!(client.get_admin(), Some(new_admin));
}

#[test]
fn test_update_fee_emits_fee_updated_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let asset = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    let client = crate::AnchorPointContractClient::new(&env, &contract_id);
    env.ledger().set_timestamp(1000);

    let events_before = env.events().all().len();
    let base_fee = 10_000_000_i128;
    let rate = 250_u32; // 2.5%

    client.update_fee(&admin, &asset, &base_fee, &rate);
    let events_after = env.events().all().len();
    assert_eq!(events_after, events_before + 1);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(last_event.1, vec![&env, TOPIC_FEE_UPDATED.into_val(&env)]);

    let payload = FeeUpdated::try_from_val(&env, &last_event.2).unwrap();
    assert_eq!(
        payload,
        FeeUpdated {
            asset: asset.clone(),
            base_fee,
            rate,
        }
    );

    let stored_fee = client.get_fee(&asset).unwrap();
    assert_eq!(stored_fee.base_fee, base_fee);
    assert_eq!(stored_fee.rate, rate);
}

#[test]
fn test_set_fee_emits_fee_updated_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    let client = crate::AnchorPointContractClient::new(&env, &contract_id);
    env.ledger().set_timestamp(1000);

    let events_before = env.events().all().len();
    client.set_fee(&admin, &75);
    let events_after = env.events().all().len();
    assert_eq!(events_after, events_before + 1);

    let last_event = env.events().all().last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(last_event.1, vec![&env, TOPIC_FEE_UPDATED.into_val(&env)]);

    let payload = FeeUpdated::try_from_val(&env, &last_event.2).unwrap();
    assert_eq!(
        payload,
        FeeUpdated {
            asset: admin.clone(),
            base_fee: 0,
            rate: 75,
        }
    );
}

#[test]
fn test_pause_and_unpause_emit_events() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    let client = crate::AnchorPointContractClient::new(&env, &contract_id);

    assert!(!client.is_paused());

    // Pause event test
    client.pause(&admin);
    let pause_events = env.events().all();
    assert_eq!(pause_events.len(), 1);

    let last_event = pause_events.last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(
        last_event.1,
        vec![&env, TOPIC_CONTRACT_PAUSED.into_val(&env)]
    );
    let payload = ContractPaused::try_from_val(&env, &last_event.2).unwrap();
    assert_eq!(payload, ContractPaused);
    assert!(client.is_paused());

    // Unpause event test
    client.unpause(&admin);
    let unpause_events = env.events().all();
    assert_eq!(unpause_events.len(), 1);

    let last_unpause_event = unpause_events.last().unwrap();
    assert_eq!(last_unpause_event.0, contract_id);
    assert_eq!(
        last_unpause_event.1,
        vec![&env, TOPIC_CONTRACT_UNPAUSED.into_val(&env)]
    );
    let unpause_payload = ContractUnpaused::try_from_val(&env, &last_unpause_event.2).unwrap();
    assert_eq!(unpause_payload, ContractUnpaused);
    assert!(!client.is_paused());
}

#[test]
fn test_set_relayer_emits_relayer_changed_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let relayer1 = Address::generate(&env);
    let relayer2 = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    let client = crate::AnchorPointContractClient::new(&env, &contract_id);

    // Initial relayer configuration
    client.set_relayer(&admin, &relayer1);
    assert_eq!(client.get_relayer(), Some(relayer1.clone()));

    // Update relayer and verify event emission
    client.set_relayer(&admin, &relayer2);
    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let last_event = events.last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(
        last_event.1,
        vec![&env, TOPIC_RELAYER_CHANGED.into_val(&env)]
    );

    let payload = RelayerChanged::try_from_val(&env, &last_event.2).unwrap();
    assert_eq!(
        payload,
        RelayerChanged {
            old_relayer: relayer1.clone(),
            new_relayer: relayer2.clone(),
        }
    );
    assert_eq!(client.get_relayer(), Some(relayer2));
}

#[test]
fn test_unauthorized_caller_rejected_without_emitting_events() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let asset = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    let client = crate::AnchorPointContractClient::new(&env, &contract_id);
    env.ledger().set_timestamp(1000);

    // Establish admin first
    client.pause(&admin);

    // Attacker attempts unauthorized mutations; none should emit events
    assert_eq!(
        client.try_set_admin(&attacker, &attacker),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(env.events().all().len(), 0);

    assert_eq!(
        client.try_update_fee(&attacker, &asset, &100, &50),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(env.events().all().len(), 0);

    assert_eq!(client.try_pause(&attacker), Err(Ok(Error::Unauthorized)));
    assert_eq!(env.events().all().len(), 0);

    assert_eq!(client.try_unpause(&attacker), Err(Ok(Error::Unauthorized)));
    assert_eq!(env.events().all().len(), 0);

    assert_eq!(
        client.try_set_relayer(&attacker, &attacker),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(env.events().all().len(), 0);
}

#[test]
fn test_update_fee_negative_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let asset = Address::generate(&env);

    let contract_id = env.register(crate::AnchorPointContract, ());
    let client = crate::AnchorPointContractClient::new(&env, &contract_id);
    env.ledger().set_timestamp(1000);

    assert_eq!(
        client.try_update_fee(&admin, &asset, &-1, &100),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(env.events().all().len(), 0);
}
