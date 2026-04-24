#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TokenA,
    TokenB,
    ReserveA,
    ReserveB,
    TotalShares,
    Shares(Address),
}

#[contract]
pub struct AMM;

#[contractimpl]
impl AMM {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    /// Initializes the AMM pool for a specific pair of tokens.
    pub fn initialize(env: Env, token_a: Address, token_b: Address) {
        if env.storage().instance().has(&DataKey::TokenA) {
            panic!("already initialized");
        }
        
        // Canonical order: ensures same pool for (A,B) and (B,A)
        if token_a < token_b {
            env.storage().instance().set(&DataKey::TokenA, &token_a);
            env.storage().instance().set(&DataKey::TokenB, &token_b);
        } else {
            env.storage().instance().set(&DataKey::TokenA, &token_b);
            env.storage().instance().set(&DataKey::TokenB, &token_a);
        }
        
        env.storage().instance().set(&DataKey::ReserveA, &0_i128);
        env.storage().instance().set(&DataKey::ReserveB, &0_i128);
        env.storage().instance().set(&DataKey::TotalShares, &0_i128);
    }

    /// Deposits liquidity into the pool. Returns the number of LP shares minted.
    pub fn deposit(env: Env, from: Address, amount_a: i128, amount_b: i128) -> i128 {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        from.require_auth();

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("not initialized");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("not initialized");
        let reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0);
        let reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0);
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0);

        // Calculate shares to mint
        let shares = if total_shares == 0 {
            // Initial liquidity = geometric mean
            sqrt(amount_a * amount_b)
        } else {
            // Proportional liquidity: min(amount_a/reserve_a, amount_b/reserve_b) * total_shares
            let shares_a = (amount_a * total_shares) / reserve_a;
            let shares_b = (amount_b * total_shares) / reserve_b;
            if shares_a < shares_b { shares_a } else { shares_b }
        };

        if shares <= 0 {
            panic!("insufficient liquidity provided");
        }

        // Transfer tokens into the contract (User -> Contract)
        transfer(&env, &token_a, &from, &env.current_contract_address(), amount_a);
        transfer(&env, &token_b, &from, &env.current_contract_address(), amount_b);

        // Update state
        env.storage().instance().set(&DataKey::ReserveA, &(reserve_a + amount_a));
        env.storage().instance().set(&DataKey::ReserveB, &(reserve_b + amount_b));
        env.storage().instance().set(&DataKey::TotalShares, &(total_shares + shares));
        
        let old_shares: i128 = env.storage().persistent().get(&DataKey::Shares(from.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::Shares(from.clone()), &(old_shares + shares));

        env.events().publish((symbol_short!("deposit"), from), (amount_a, amount_b, shares));
        shares
    }

    /// Swaps tokens using the constant product formula (x * y = k) with a 0.3% fee.
    pub fn swap(env: Env, from: Address, token_in: Address, amount_in: i128, min_amount_out: i128) -> i128 {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        from.require_auth();

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("not initialized");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("not initialized");
        let mut reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap();
        let mut reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap();

        let (reserve_in, reserve_out, token_out) = if token_in == token_a {
            (reserve_a, reserve_b, token_b.clone())
        } else if token_in == token_b {
            (reserve_b, reserve_a, token_a.clone())
        } else {
            panic!("invalid token for pool");
        };

        // Transfer token_in from user to contract
        transfer(&env, &token_in, &from, &env.current_contract_address(), amount_in);

        // Constant product formula with 0.3% fee: dy = (reserve_out * dx * 997) / (reserve_in * 1000 + dx * 997)
        let amount_in_with_fee = amount_in * 997;
        let numerator = amount_in_with_fee * reserve_out;
        let denominator = (reserve_in * 1000) + amount_in_with_fee;
        let amount_out = numerator / denominator;

        if amount_out < min_amount_out {
            panic!("slippage exceeded");
        }

        // Update state
        if token_in == token_a {
            reserve_a += amount_in;
            reserve_b -= amount_out;
        } else {
            reserve_b += amount_in;
            reserve_a -= amount_out;
        }

        env.storage().instance().set(&DataKey::ReserveA, &reserve_a);
        env.storage().instance().set(&DataKey::ReserveB, &reserve_b);

        // Transfer token_out from contract to user
        transfer(&env, &token_out, &env.current_contract_address(), &from, amount_out);

        env.events().publish((symbol_short!("swap"), from), (amount_in, amount_out));
        amount_out
    }

    /// Withdraws liquidity from the pool.
    pub fn withdraw(env: Env, from: Address, shares: i128) -> (i128, i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        from.require_auth();

        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("not initialized");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("not initialized");
        let reserve_a: i128 = env.storage().instance().get(&DataKey::ReserveA).unwrap();
        let reserve_b: i128 = env.storage().instance().get(&DataKey::ReserveB).unwrap();
        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap();

        let user_shares: i128 = env.storage().persistent().get(&DataKey::Shares(from.clone())).unwrap_or(0);
        if user_shares < shares {
            panic!("insufficient shares");
        }

        let amount_a = (shares * reserve_a) / total_shares;
        let amount_b = (shares * reserve_b) / total_shares;

        // Update state
        env.storage().instance().set(&DataKey::ReserveA, &(reserve_a - amount_a));
        env.storage().instance().set(&DataKey::ReserveB, &(reserve_b - amount_b));
        env.storage().instance().set(&DataKey::TotalShares, &(total_shares - shares));
        env.storage().persistent().set(&DataKey::Shares(from.clone()), &(user_shares - shares));

        // Transfer tokens back to user
        transfer(&env, &token_a, &env.current_contract_address(), &from, amount_a);
        transfer(&env, &token_b, &env.current_contract_address(), &from, amount_b);

        env.events().publish((symbol_short!("withdraw"), from), (amount_a, amount_b, shares));
        (amount_a, amount_b)
    }

    pub fn get_reserves(env: Env) -> (i128, i128) {
        (
            env.storage().instance().get(&DataKey::ReserveA).unwrap_or(0),
            env.storage().instance().get(&DataKey::ReserveB).unwrap_or(0),
        )
    }
}

/// Helper function to perform cross-contract token transfers.
fn transfer(env: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
    env.invoke_contract::<()>(
        token,
        &symbol_short!("transfer"),
        (from.clone(), to.clone(), amount).into_val(env),
    );
}

/// Babylonian method for integer square root.
fn sqrt(y: i128) -> i128 {
    if y > 3 {
        let mut z = y;
        let mut x = y / 2 + 1;
        while x < z {
            z = x;
            x = (y / x + x) / 2;
        }
        z
    } else if y != 0 {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _};
    
    #[test]
    fn test_initialization() {
        let env = Env::default();
        let token_a = Address::generate(&env);
        let token_b = Address::generate(&env);
        
        let contract_id = env.register(AMM, ());
        let client = AMMClient::new(&env, &contract_id);
        
        client.initialize(&token_a, &token_b);
        let (r_a, r_b) = client.get_reserves();
        assert_eq!(r_a, 0);
        assert_eq!(r_b, 0);
    }
}
