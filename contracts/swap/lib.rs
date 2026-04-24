#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TokenA,
    TokenB,
    ReserveA,
    ReserveB,
}

#[contract]
pub struct MultiAssetSwap;

#[contractimpl]
impl MultiAssetSwap {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    /// Initializes the swap pool.
    pub fn initialize(env: Env, token_a: Address, token_b: Address) {
        if env.storage().instance().has(&DataKey::TokenA) {
            panic!("already initialized");
        }
        
        env.storage().instance().set(&DataKey::TokenA, &token_a);
        env.storage().instance().set(&DataKey::TokenB, &token_b);
        env.storage().instance().set(&DataKey::ReserveA, &0_i128);
        env.storage().instance().set(&DataKey::ReserveB, &0_i128);
    }

    /// Deposits liquidity into the pool.
    pub fn deposit(env: Env, from: Address, amount_a: i128, amount_b: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        from.require_auth();
        assert!(amount_a > 0 && amount_b > 0, "amount must be positive");

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("not initialized");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("not initialized");

        // Transfer tokens into the contract
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &token_a).transfer(&from, &contract_addr, &amount_a);
        token::Client::new(&env, &token_b).transfer(&from, &contract_addr, &amount_b);

        let reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);

        env.storage().instance().set(&DataKey::ReserveA, &(reserve_a + amount_a));
        env.storage().instance().set(&DataKey::ReserveB, &(reserve_b + amount_b));

        env.events().publish((symbol_short!("deposit"), from), (amount_a, amount_b));
    }

    /// Swaps tokens using the constant product formula (with a 0.3% fee).
    /// Supports custom slippage via `min_amount_out`.
    pub fn swap(
        env: Env,
        from: Address,
        token_in: Address,
        amount_in: i128,
        min_amount_out: i128,
    ) -> i128 {
        from.require_auth();
        assert!(amount_in > 0, "amount must be positive");

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("not initialized");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("not initialized");

        let mut reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let mut reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);

        let is_a_in = token_in == token_a;
        if !is_a_in && token_in != token_b {
            panic!("invalid token");
        }

        let (reserve_in, reserve_out, token_out) = if is_a_in {
            (reserve_a, reserve_b, token_b.clone())
        } else {
            (reserve_b, reserve_a, token_a.clone())
        };

        if reserve_in == 0 || reserve_out == 0 {
            panic!("insufficient liquidity");
        }

        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &token_in).transfer(&from, &contract_addr, &amount_in);

        // Constant product formula with 0.3% fee
        // amount_out = (reserve_out * amount_in_with_fee) / (reserve_in * 1000 + amount_in_with_fee)
        let amount_in_with_fee = amount_in * 997;
        let numerator = amount_in_with_fee * reserve_out;
        let denominator = (reserve_in * 1000) + amount_in_with_fee;
        let amount_out = numerator / denominator;

        if amount_out < min_amount_out {
            panic!("slippage exceeded");
        }
        if amount_out >= reserve_out {
            panic!("insufficient out liquidity");
        }

        // Update reserves
        if is_a_in {
            reserve_a += amount_in;
            reserve_b -= amount_out;
        } else {
            reserve_b += amount_in;
            reserve_a -= amount_out;
        }

        env.storage().instance().set(&DataKey::ReserveA, &reserve_a);
        env.storage().instance().set(&DataKey::ReserveB, &reserve_b);

        // Transfer token_out to user
        token::Client::new(&env, &token_out).transfer(&contract_addr, &from, &amount_out);

        env.events().publish((symbol_short!("swap"), from), (amount_in, amount_out));

        amount_out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
    };

    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);

        let token_a_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_b_id = env.register_stellar_asset_contract_v2(admin.clone());

        let a_sac = StellarAssetClient::new(&env, &token_a_id.address());
        let b_sac = StellarAssetClient::new(&env, &token_b_id.address());

        a_sac.mint(&alice, &100_000);
        b_sac.mint(&alice, &100_000);

        let contract_id = env.register_contract(None, MultiAssetSwap);
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        client.initialize(&token_a_id.address(), &token_b_id.address());

        (env, contract_id, admin, alice, token_a_id.address(), token_b_id.address())
    }

    #[test]
    fn test_swap() {
        let (env, contract_id, _admin, alice, token_a, token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        client.deposit(&alice, &10_000, &10_000);

        let a_client = TokenClient::new(&env, &token_a);
        let b_client = TokenClient::new(&env, &token_b);

        assert_eq!(a_client.balance(&contract_id), 10_000);
        assert_eq!(b_client.balance(&contract_id), 10_000);

        let out = client.swap(&alice, &token_a, &1_000, &500);
        assert!(out > 0);

        assert_eq!(a_client.balance(&contract_id), 11_000);
        assert_eq!(b_client.balance(&contract_id), 10_000 - out);
    }

    #[test]
    #[should_panic(expected = "slippage exceeded")]
    fn test_slippage_revert() {
        let (env, contract_id, _admin, alice, token_a, _token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        client.deposit(&alice, &10_000, &10_000);

        // This should panic because min_amount_out is impossibly high
        client.swap(&alice, &token_a, &1_000, &9_000);
    }
}
