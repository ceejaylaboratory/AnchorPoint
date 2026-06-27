//! Example: Vulnerable Vault Contract (WITHOUT Reentrancy Protection)
//!
//! This example demonstrates a vulnerable vault contract that is susceptible
//! to reentrancy attacks. DO NOT use this pattern in production!

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
pub enum DataKey {
    Balance(Address),
    Token,
}

#[contract]
pub struct VulnerableVault;

#[contractimpl]
impl VulnerableVault {
    /// Initialize the vault with a token
    pub fn initialize(env: Env, token: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
    }

    /// Deposit tokens into the vault
    pub fn deposit(env: Env, from: Address, amount: i128) {
        from.require_auth();

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);

        let balance = Self::get_balance(&env, &from);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from), &(balance + amount));
    }

    /// VULNERABLE: Withdraw tokens from the vault
    /// This function is vulnerable to reentrancy attacks because it:
    /// 1. Checks the balance
    /// 2. Makes an external call (transfer)
    /// 3. Updates the balance AFTER the external call
    pub fn withdraw_vulnerable(env: Env, to: Address, amount: i128) {
        to.require_auth();

        let balance = Self::get_balance(&env, &to);
        assert!(balance >= amount, "insufficient balance");

        // VULNERABILITY: External call before state update
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token).transfer(&env.current_contract_address(), &to, &amount);

        // State update happens AFTER external call
        // An attacker can re-enter here before this line executes
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to), &(balance - amount));
    }

    /// Get balance of an address
    pub fn get_balance(env: &Env, addr: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(addr.clone()))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{StellarAssetClient, Client as TokenClient},
        Address, Env,
    };

    #[test]
    fn test_normal_deposit_withdraw() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_sac = StellarAssetClient::new(&env, &token_id.address());
        token_sac.mint(&user, &1000);

        let vault_id = env.register_contract(None, VulnerableVault);
        let vault = VulnerableVaultClient::new(&env, &vault_id);

        vault.initialize(&token_id.address());
        vault.deposit(&user, &500);

        assert_eq!(vault.get_balance(&user), 500);

        vault.withdraw_vulnerable(&user, &200);
        assert_eq!(vault.get_balance(&user), 300);

        let token_client = TokenClient::new(&env, &token_id.address());
        assert_eq!(token_client.balance(&user), 700); // 1000 - 500 + 200
    }
}
