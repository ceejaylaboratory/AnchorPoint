#![cfg(test)]
use super::{BatchExecutor, BatchExecutorClient, Call};
use soroban_sdk::{contract, contractimpl, symbol_short, testutils::Address as _, Address, Env, Vec, IntoVal, FromVal};

#[contract]
pub struct MockContract;

#[contractimpl]
impl MockContract {
    pub fn echo(_env: Env, value: u32) -> u32 {
        value
    }
    
    pub fn add(_env: Env, a: u32, b: u32) -> u32 {
        a + b
    }
}

fn setup() -> (Env, BatchExecutorClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(BatchExecutor, ());
    let client = BatchExecutorClient::new(&env, &contract_id);
    client.initialize(&admin);
    (env, client, admin)
}

#[test]
fn test_initialize() {
    let (_, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_nonce(&admin), 0);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let (_env, client, admin) = setup();
    client.initialize(&admin);
}

#[test]
fn test_execute_batch() {
    let (env, client, _) = setup();
    
    let mock_id = env.register(MockContract, ());
    let mock_symbol = symbol_short!("echo");
    let caller = Address::generate(&env);

    let call1 = Call {
        contract: mock_id.clone(),
        function: mock_symbol.clone(),
        args: (123u32,).into_val(&env),
    };

    let call2 = Call {
        contract: mock_id.clone(),
        function: mock_symbol.clone(),
        args: (456u32,).into_val(&env),
    };

    let calls = Vec::from_array(&env, [call1, call2]);
    let results = client.execute_batch(&caller, &calls);

    assert_eq!(results.len(), 2);
    assert_eq!(u32::from_val(&env, &results.get_unchecked(0)), 123u32);
    assert_eq!(u32::from_val(&env, &results.get_unchecked(1)), 456u32);
    
    // Nonce should be incremented
    assert_eq!(client.get_nonce(&caller), 1);
}

#[test]
fn test_execute_batch_with_different_functions() {
    let (env, client, _) = setup();
    
    let mock_id = env.register(MockContract, ());
    let caller = Address::generate(&env);

    let call1 = Call {
        contract: mock_id.clone(),
        function: symbol_short!("echo"),
        args: (100u32,).into_val(&env),
    };

    let call2 = Call {
        contract: mock_id.clone(),
        function: symbol_short!("add"),
        args: (10u32, 20u32).into_val(&env),
    };

    let calls = Vec::from_array(&env, [call1, call2]);
    let results = client.execute_batch(&caller, &calls);

    assert_eq!(results.len(), 2);
    assert_eq!(u32::from_val(&env, &results.get_unchecked(0)), 100u32);
    assert_eq!(u32::from_val(&env, &results.get_unchecked(1)), 30u32);
}

#[test]
fn test_nonce_increments() {
    let (env, client, _) = setup();
    
    let mock_id = env.register(MockContract, ());
    let caller = Address::generate(&env);

    let call = Call {
        contract: mock_id.clone(),
        function: symbol_short!("echo"),
        args: (1u32,).into_val(&env),
    };

    let calls = Vec::from_array(&env, [call.clone()]);
    
    // First execution
    client.execute_batch(&caller, &calls);
    assert_eq!(client.get_nonce(&caller), 1);
    
    // Second execution
    client.execute_batch(&caller, &calls);
    assert_eq!(client.get_nonce(&caller), 2);
    
    // Third execution
    client.execute_batch(&caller, &calls);
    assert_eq!(client.get_nonce(&caller), 3);
}

#[test]
fn test_empty_batch() {
    let (env, client, _) = setup();
    let caller = Address::generate(&env);
    
    let calls: Vec<Call> = Vec::new(&env);
    let results = client.execute_batch(&caller, &calls);
    
    assert_eq!(results.len(), 0);
    assert_eq!(client.get_nonce(&caller), 1);
}

#[test]
fn test_multiple_users_have_separate_nonces() {
    let (env, client, _) = setup();
    
    let mock_id = env.register(MockContract, ());
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let call = Call {
        contract: mock_id.clone(),
        function: symbol_short!("echo"),
        args: (1u32,).into_val(&env),
    };

    let calls = Vec::from_array(&env, [call]);
    
    // User1 executes batch
    client.execute_batch(&user1, &calls);
    assert_eq!(client.get_nonce(&user1), 1);
    assert_eq!(client.get_nonce(&user2), 0);
    
    // User2 executes batch
    client.execute_batch(&user2, &calls);
    assert_eq!(client.get_nonce(&user1), 1);
    assert_eq!(client.get_nonce(&user2), 1);
}
