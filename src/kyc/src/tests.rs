use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Registers the contract and returns (env, contract_id, admin_address).
/// Uses mock_all_auths so initialize() doesn't need a real signed tx.
fn setup(mock_auths: bool) -> (Env, Address, Address) {
    let env = Env::default();
    if mock_auths {
        env.mock_all_auths();
    }

    let contract_id = env.register_contract(None, KycVerifier);
    let admin = Address::generate(&env);

    if mock_auths {
        let client = KycVerifierClient::new(&env, &contract_id);
        client.initialize(&admin, &BytesN::from_array(&env, &[1u8; 32]));
    }

    (env, contract_id, admin)
}

/// Injects a KYC record directly into persistent storage,
/// bypassing signature verification. Safe for test setup only.
fn inject_kyc(env: &Env, contract_id: &Address, user: &Address, expires_at: u64) {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::UserKyc(user.clone()), &expires_at);
    });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

/// Happy path: after revocation, is_kyc_valid returns false
/// and the storage entry is fully removed.
#[test]
fn test_revoke_kyc_removes_record() {
    let (env, contract_id, admin) = setup(true);
    let client = KycVerifierClient::new(&env, &contract_id);

    env.ledger().with_mut(|li| li.timestamp = 1_000);

    let user = Address::generate(&env);
    inject_kyc(&env, &contract_id, &user, 999_999);

    assert!(client.is_kyc_valid(&user), "KYC should be valid before revocation");

    client.revoke_kyc(&user);

    assert!(!client.is_kyc_valid(&user), "KYC should be invalid after revocation");

    // Confirm the key is truly gone from storage, not just expired
    let still_exists = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .has(&DataKey::UserKyc(user.clone()))
    });
    assert!(!still_exists, "Storage entry should be fully removed");
}

/// Revoking a user who never had a KYC record should panic.
#[test]
#[should_panic(expected = "no KYC record found for user")]
fn test_revoke_kyc_panics_on_missing_record() {
    let (env, contract_id, _admin) = setup(true);
    let client = KycVerifierClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    client.revoke_kyc(&user); // No record was ever set
}

/// A non-admin caller must not be able to revoke KYC.
/// We set up state directly (no mock_all_auths) so require_auth()
/// runs without any authorization being present — it should panic.
#[test]
#[should_panic]
fn test_revoke_kyc_rejects_non_admin() {
    let env = Env::default();
    // Intentionally NOT calling env.mock_all_auths()

    let contract_id = env.register_contract(None, KycVerifier);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Bootstrap state directly, bypassing auth entirely
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerifierPubKey, &BytesN::from_array(&env, &[1u8; 32]));
        env.storage()
            .persistent()
            .set(&DataKey::UserKyc(user.clone()), &999_999_u64);
    });

    let client = KycVerifierClient::new(&env, &contract_id);

    // admin.require_auth() inside revoke_kyc will panic —
    // no auth has been provided for this invocation
    client.revoke_kyc(&user);
}