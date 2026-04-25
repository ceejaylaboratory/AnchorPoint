#![cfg(test)]
use super::{BatchExecutor, BatchExecutorClient, Call};
use soroban_sdk::{contract, contractimpl, symbol_short, Env, IntoVal, Vec};

#[contract]
pub struct MockContract;

#[contractimpl]
impl MockContract {
    pub fn echo(_env: Env, value: u32) -> u32 {
        value
    }
}

#[test]
fn test_execute_batch() {
    let env = Env::default();
    let contract_id = env.register_contract(None, BatchExecutor);
    let client = BatchExecutorClient::new(&env, &contract_id);

    let mock_id = env.register_contract(None, MockContract);
    let mock_symbol = symbol_short!("echo");

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
    let results = client.execute_batch(&calls);

    assert_eq!(results.len(), 2);
    assert_eq!(results.get_unchecked(0).into_val::<u32>(&env), 123u32);
    assert_eq!(results.get_unchecked(1).into_val::<u32>(&env), 456u32);
}
