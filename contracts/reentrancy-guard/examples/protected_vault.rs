//! Example: Protected Vault Contract (WITH Reentrancy Protection)
//!
//! This example demonstrates how to properly protect a vault contract
//! against reentrancy attacks using the ReentrancyGuard.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

// Import the reentrancy guard
use reentrancy_guard::{ReentrancyGuard, ReentrancyError};

#[contracttype]
pub enum DataKey {
    Balance(Address),
    Token,
}

#[contract]
pub struct ProtectedVault;

#[contractimpl]
impl ProtectedVault {
    /// Initialize the vault with a token
    pub fn initialize(env: Env, token: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
    }

    /// Deposit tokens into the vault (protected)
    pub fn deposit(env: Env, from: Address, amount: i128) -> Result<(), ReentrancyError> {
        // Acquire reentrancy guard
        let _guard = ReentrancyGuard::new(&env)?;
        
        from.require_auth();

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);

        let balance = Self::get_balance(&env, &from);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from), &(balance + amount));

        Ok(())
    }

    /// PROTECTED: Withdraw tokens from the vault
    /// This function is protected against reentrancy attacks by:
    /// 1. Acquiring a reentrancy guard at the start
    /// 2. The guard prevents any recursive calls
    /// 3. The guard is automatically released when the function returns
    pub fn withdraw(env: Env, to: Address, amount: i128) -> Result<(), ReentrancyError> {
        // Acquire reentrancy guard - this will fail if already locked
        let _guard = ReentrancyGuard::new(&env)?;
        
        to.require_auth();

        let balance = Self::get_balance(&env, &to);
        assert!(balance >= amount, "insufficient balance");

        // Update state BEFORE external call (Checks-Effects-Interactions pattern)
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(balance - amount));

        // External call happens after state update
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token).transfer(&env.current_contract_address(), &to, &amount);

        // Guard is automatically released here when _guard goes out of scope
        Ok(())
    }

    /// Alternative: Withdraw with explicit guard management
    pub fn withdraw_explicit(env: Env, to: Address, amount: i128) -> Result<(), ReentrancyError> {
        to.require_auth();

        // Use the helper trait for explicit guard management
        use reentrancy_guard::ReentrancyProtected;
        
        <()>::with_guard(&env, || {
            let balance = Self::get_balance(&env, &to);
            assert!(balance >= amount, "insufficient balance");

            env.storage()
                .persistent()
                .set(&DataKey::Balance(to.clone()), &(balance - amount));

            let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
            token::Client::new(&env, &token).transfer(&env.current_contract_address(), &to, &amount);
        })
    }

    /// Batch withdraw (demonstrates nested protection)
    pub fn batch_withdraw(
        env: Env,
        recipients: soroban_sdk::Vec<Address>,
        amounts: soroban_sdk::Vec<i128>,
    ) -> Result<(), ReentrancyError> {
        // Outer guard protects the batch operation
        let _guard = ReentrancyGuard::new(&env)?;

        assert_eq!(recipients.len(), amounts.len(), "length mismatch");

        for i in 0..recipients.len() {
            let recipient = recipients.get(i).unwrap();
            let amount = amounts.get(i).unwrap();

            recipient.require_auth();

            let balance = Self::get_balance(&env, &recipient);
            assert!(balance >= amount, "insufficient balance");

            env.storage()
                .persistent()
                .set(&DataKey::Balance(recipient.clone()), &(balance - amount));

            let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
            token::Client::new(&env, &token).transfer(
                &env.current_contract_address(),
                &recipient,
                &amount,
            );
        }

        Ok(())
    }

    /// Get balance of an address (read-only, no guard needed)
    pub fn get_balance(env: &Env, addr: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(addr.clone()))
            .unwrap_or(0)
    }

    /// Check if vault is currently locked (for debugging)
    pub fn is_locked(env: Env) -> bool {
        ReentrancyGuard::is_locked(&env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{StellarAssetClient, Client as TokenClient},
        vec, Address, Env,
    };

    #[test]
    fn test_protected_deposit_withdraw() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_sac = StellarAssetClient::new(&env, &token_id.address());
        token_sac.mint(&user, &1000);

        let vault_id = env.register_contract(None, ProtectedVault);
        let vault = ProtectedVaultClient::new(&env, &vault_id);

        vault.initialize(&token_id.address());
        vault.deposit(&user, &500).unwrap();

        assert_eq!(vault.get_balance(&user), 500);

        vault.withdraw(&user, &200).unwrap();
        assert_eq!(vault.get_balance(&user), 300);

        let token_client = TokenClient::new(&env, &token_id.address());
        assert_eq!(token_client.balance(&user), 700);
    }

    #[test]
    fn test_reentrancy_protection() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_sac = StellarAssetClient::new(&env, &token_id.address());
        token_sac.mint(&user, &1000);

        let vault_id = env.register_contract(None, ProtectedVault);
        let vault = ProtectedVaultClient::new(&env, &vault_id);

        vault.initialize(&token_id.address());
        vault.deposit(&user, &500).unwrap();

        // Simulate reentrancy by manually locking
        let _guard = ReentrancyGuard::new(&env).unwrap();
        
        // This should fail with ReentrantCall error
        let result = vault.withdraw(&user, &100);
        assert_eq!(result, Err(Ok(ReentrancyError::ReentrantCall)));
    }

    #[test]
    fn test_batch_withdraw() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_sac = StellarAssetClient::new(&env, &token_id.address());
        token_sac.mint(&user1, &1000);
        token_sac.mint(&user2, &1000);

        let vault_id = env.register_contract(None, ProtectedVault);
        let vault = ProtectedVaultClient::new(&env, &vault_id);

        vault.initialize(&token_id.address());
        vault.deposit(&user1, &500).unwrap();
        vault.deposit(&user2, &300).unwrap();

        let recipients = vec![&env, user1.clone(), user2.clone()];
        let amounts = vec![&env, 200, 100];

        vault.batch_withdraw(&recipients, &amounts).unwrap();

        assert_eq!(vault.get_balance(&user1), 300);
        assert_eq!(vault.get_balance(&user2), 200);
    }

    #[test]
    fn test_explicit_guard() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_sac = StellarAssetClient::new(&env, &token_id.address());
        token_sac.mint(&user, &1000);

        let vault_id = env.register_contract(None, ProtectedVault);
        let vault = ProtectedVaultClient::new(&env, &vault_id);

        vault.initialize(&token_id.address());
        vault.deposit(&user, &500).unwrap();

        vault.withdraw_explicit(&user, &200).unwrap();
        assert_eq!(vault.get_balance(&user), 300);
    }

    #[test]
    fn test_lock_status() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let vault_id = env.register_contract(None, ProtectedVault);
        let vault = ProtectedVaultClient::new(&env, &vault_id);

        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        vault.initialize(&token_id.address());

        // Initially not locked
        assert!(!vault.is_locked());

        // Lock it
        let _guard = ReentrancyGuard::new(&env).unwrap();
        assert!(vault.is_locked());
    }
}
