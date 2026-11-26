#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, Symbol};

fn setup() -> (Env, RegistryContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, RegistryContract);
    let client = RegistryContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let governance = Address::generate(&env);
    client.initialize(&admin, &governance);
    (env, client, admin, governance)
}

fn hash(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

#[test]
fn test_register_and_lookup() {
    let (env, client, _admin, _gov) = setup();
    let addr = Address::generate(&env);
    let wasm = hash(&env, 1);

    client.register(&ContractType::Anchor, &addr, &wasm);

    let entry = client.get(&ContractType::Anchor).unwrap();
    assert_eq!(entry.address, addr);
    assert_eq!(entry.version, 1);
    assert_eq!(entry.wasm_hash, wasm);
}

#[test]
fn test_unauthorized_upgrade_rejected() {
    let (env, client, _admin, _gov) = setup();
    let addr = Address::generate(&env);
    let new_addr = Address::generate(&env);
    client.register(&ContractType::Anchor, &addr, &hash(&env, 1));

    // No governance approval recorded -> upgrade must fail.
    let result = client.try_upgrade(&ContractType::Anchor, &new_addr, &hash(&env, 2));
    assert!(result.is_err());

    // Registry pointer unchanged.
    let entry = client.get(&ContractType::Anchor).unwrap();
    assert_eq!(entry.address, addr);
    assert_eq!(entry.version, 1);
}

#[test]
fn test_authorized_upgrade_flow() {
    let (env, client, _admin, _gov) = setup();
    let addr = Address::generate(&env);
    let new_addr = Address::generate(&env);
    let new_wasm = hash(&env, 2);
    client.register(&ContractType::Anchor, &addr, &hash(&env, 1));

    client.approve_upgrade(&ContractType::Anchor, &new_addr, &new_wasm);
    client.upgrade(&ContractType::Anchor, &new_addr, &new_wasm);

    let entry = client.get(&ContractType::Anchor).unwrap();
    assert_eq!(entry.address, new_addr);
    assert_eq!(entry.version, 2);
    assert_eq!(entry.wasm_hash, new_wasm);
}

#[test]
fn test_history_preserved() {
    let (env, client, _admin, _gov) = setup();
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);
    let addr3 = Address::generate(&env);
    client.register(&ContractType::Anchor, &addr1, &hash(&env, 1));

    client.approve_upgrade(&ContractType::Anchor, &addr2, &hash(&env, 2));
    client.upgrade(&ContractType::Anchor, &addr2, &hash(&env, 2));

    client.approve_upgrade(&ContractType::Anchor, &addr3, &hash(&env, 3));
    client.upgrade(&ContractType::Anchor, &addr3, &hash(&env, 3));

    let history = client.get_history(&ContractType::Anchor);
    assert_eq!(history.len(), 3);
    assert_eq!(history.get(0).unwrap().address, addr1);
    assert_eq!(history.get(0).unwrap().version, 1);
    assert_eq!(history.get(1).unwrap().address, addr2);
    assert_eq!(history.get(1).unwrap().version, 2);
    assert_eq!(history.get(2).unwrap().address, addr3);
    assert_eq!(history.get(2).unwrap().version, 3);
}

#[test]
fn test_upgrade_emits_event() {
    let (env, client, _admin, _gov) = setup();
    let addr = Address::generate(&env);
    let new_addr = Address::generate(&env);
    client.register(&ContractType::Anchor, &addr, &hash(&env, 1));

    client.approve_upgrade(&ContractType::Anchor, &new_addr, &hash(&env, 2));
    client.upgrade(&ContractType::Anchor, &new_addr, &hash(&env, 2));

    let events = env.events().all();
    let last = events.last().unwrap();
    let expected = ContractUpgraded {
        contract_type: ContractType::Anchor,
        old_address: addr,
        new_address: new_addr,
        version: 2,
    };
    assert_eq!(last.1, Symbol::new(&env, "upgraded"));
    assert_eq!(last.2, expected);
}
