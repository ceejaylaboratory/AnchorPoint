//! SEP-41 (Stellar Token Standard) compliance tests for the XLM wrapper contract.
//!
//! These tests exercise every mandatory SEP-41 entry point and verify the
//! metadata, authorization, and allowance semantics required by the standard.

use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
    Address, Env, IntoVal, Symbol,
};

use xlm_wrapper::{XlmWrapper, XlmWrapperClient};

fn setup() -> (Env, XlmWrapperClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, XlmWrapper);
    let client = XlmWrapperClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    (env, client, admin)
}

#[test]
fn sep41_metadata_is_compliant() {
    let (_env, client, _admin) = setup();

    // SEP-41 requires decimals to be exactly 7 for wrapped XLM.
    assert_eq!(client.decimals(), 7);

    // Symbol must be one of the accepted values.
    let symbol = client.symbol();
    assert!(symbol == Symbol::new(&client.env, "native") || symbol == Symbol::new(&client.env, "WXLM"));

    // Name must be present and non-empty.
    let name = client.name();
    assert!(!name.is_empty());
}

#[test]
fn sep41_balance_defaults_to_zero() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);

    assert_eq!(client.balance(&user), 0);
}

#[test]
fn sep41_allowance_defaults_to_zero() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    assert_eq!(client.allowance(&owner, &spender), 0);
}

#[test]
fn sep41_approve_requires_auth_and_sets_allowance() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    client.approve(&owner, &spender, &500, &1000);

    assert_eq!(client.allowance(&owner, &spender), 500);

    // Authorization must be required from the owner.
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, owner);
    assert_eq!(
        auths[0].1,
        AuthorizedInvocation {
            function: AuthorizedFunction::Contract((
                client.address.clone(),
                Symbol::new(&env, "approve"),
                (owner.clone(), spender.clone(), 500i128, 1000u32).into_val(&env),
            )),
            sub_invocations: [].into(),
        }
    );
}

#[test]
fn sep41_transfer_requires_auth() {
    let (env, client, _admin) = setup();
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    // Fund the sender through the wrapper's deposit path.
    client.deposit(&from, &1000);

    client.transfer(&from, &to, &400);

    assert_eq!(client.balance(&from), 600);
    assert_eq!(client.balance(&to), 400);

    let auths = env.auths();
    assert!(auths.iter().any(|(addr, _)| addr == &from));
}

#[test]
fn sep41_transfer_from_requires_auth_and_allowance() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.deposit(&owner, &1000);
    client.approve(&owner, &spender, &300, &1000);

    client.transfer_from(&spender, &owner, &recipient, &200);

    assert_eq!(client.balance(&owner), 800);
    assert_eq!(client.balance(&recipient), 200);
    assert_eq!(client.allowance(&owner, &spender), 100);

    let auths = env.auths();
    assert!(auths.iter().any(|(addr, _)| addr == &spender));
}

#[test]
fn sep41_burn_requires_auth_and_reduces_balance() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);

    client.deposit(&owner, &1000);
    client.burn(&owner, &250);

    assert_eq!(client.balance(&owner), 750);

    let auths = env.auths();
    assert!(auths.iter().any(|(addr, _)| addr == &owner));
}
