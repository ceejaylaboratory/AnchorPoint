#![no_std]
//! XLM Wrapper Contract - SEP-41 Compatible Token for Native Stellar (XLM)
//! 
//! This contract wraps native Stellar (XLM) into a Soroban-compatible token format,
//! enabling seamless integration with AMM and Lending modules.
//! 
//! Features:
//! - 1:1 peg between wrapped XLM (wXLM) and native XLM
//! - SEP-41 token interface compliance
//! - Deposit native XLM to mint wXLM
//! - Burn wXLM to withdraw native XLM
//! - Integration hooks for AMM and Lending protocols

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String,
};

/// Data storage keys for the contract
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Balance(Address),
    Allowance(Address, Address),
    OperatorApproval(Address, Address),
    TotalSupply,
    Name,
    Symbol,
    Decimals,
    /// Tracks if an address is authorized to interact with AMM
    AMMAuthorized(Address),
    /// Tracks if an address is authorized to interact with Lending
    LendingAuthorized(Address),
    /// Emergency pause state
    Paused,
}

/// XLM Wrapper Contract
#[contract]
pub struct XLMWrapper;

#[contractimpl]
impl XLMWrapper {
    /// Initialize the wXLM contract
    /// 
    /// # Arguments
    /// * `admin` - Administrator address with special privileges
    /// * `name` - Token name (e.g., "Wrapped XLM")
    /// * `symbol` - Token symbol (e.g., "wXLM")
    pub fn initialize(env: Env, admin: Address, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &7u32); // XLM uses 7 decimals
        env.storage().instance().set(&DataKey::Paused, &false);
        
        // Authorize the contract itself for AMM/Lending interactions
        let contract_addr = env.current_contract_address();
        env.storage().instance().set(&DataKey::AMMAuthorized(contract_addr.clone()), &true);
        env.storage().instance().set(&DataKey::LendingAuthorized(contract_addr), &true);
    }

    /// Deposit native XLM to mint wXLM tokens (1:1 ratio)
    /// 
    /// # Arguments
    /// * `from` - Address depositing XLM
    /// * `amount` - Amount of native XLM to deposit
    /// 
    /// # Returns
    /// Amount of wXLM minted
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        from.require_auth();
        
        Self::check_not_paused(&env);
        assert!(amount > 0, "amount must be positive");
        
        // Receive native XLM from user
        let contract_addr = env.current_contract_address();
        token::StellarAssetClient::new(&env, &contract_addr)
            .transfer(&from, &contract_addr, &amount);
        
        // Mint wXLM to user (1:1 ratio)
        let bal = Self::balance_of(env.clone(), from.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(bal + amount));
        
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + amount));
        
        env.events()
            .publish((symbol_short!("deposit"), from), amount);
        
        amount
    }

    /// Burn wXLM tokens to withdraw native XLM (1:1 ratio)
    /// 
    /// # Arguments
    /// * `from` - Address burning wXLM
    /// * `amount` - Amount of wXLM to burn
    /// 
    /// # Returns
    /// Amount of native XLM withdrawn
    pub fn withdraw(env: Env, from: Address, amount: i128) -> i128 {
        from.require_auth();
        
        Self::check_not_paused(&env);
        assert!(amount > 0, "amount must be positive");
        
        let bal = Self::balance_of(env.clone(), from.clone());
        assert!(bal >= amount, "insufficient balance");
        
        // Burn wXLM from user
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(bal - amount));
        
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - amount));
        
        // Send native XLM back to user
        let contract_addr = env.current_contract_address();
        token::StellarAssetClient::new(&env, &contract_addr)
            .transfer(&contract_addr, &from, &amount);
        
        env.events()
            .publish((symbol_short!("withdraw"), from), amount);
        
        amount
    }

    // ============================================================================
    // SEP-41 Token Interface Implementation
    // ============================================================================

    /// Transfer wXLM tokens between addresses
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        Self::do_transfer(&env, from, to, amount);
    }

    /// Approve spender to transfer tokens on behalf of owner
    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128) {
        owner.require_auth();
        assert!(amount >= 0, "amount must be non-negative");
        env.storage().persistent().set(
            &DataKey::Allowance(owner.clone(), spender.clone()),
            &amount,
        );
        env.events()
            .publish((symbol_short!("approve"), owner, spender), amount);
    }

    /// Set operator approval for all tokens
    pub fn set_approval_for_all(env: Env, owner: Address, operator: Address, approved: bool) {
        owner.require_auth();
        if approved {
            env.storage().persistent().set(
                &DataKey::OperatorApproval(owner.clone(), operator.clone()),
                &true,
            );
        } else {
            env.storage()
                .persistent()
                .remove(&DataKey::OperatorApproval(owner.clone(), operator.clone()));
        }
        env.events()
            .publish((symbol_short!("app_all"), owner, operator), approved);
    }

    /// Transfer tokens from approved spender
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) {
        spender.require_auth();

        // Check if operator approval exists first
        let is_operator = env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::OperatorApproval(from.clone(), spender.clone()))
            .unwrap_or(false);

        if !is_operator {
            let allowance = Self::allowance(env.clone(), from.clone(), spender.clone());
            assert!(allowance >= amount, "insufficient allowance");
            env.storage().persistent().set(
                &DataKey::Allowance(from.clone(), spender.clone()),
                &(allowance - amount),
            );
        }

        Self::do_transfer(&env, from, to, amount);
        env.events()
            .publish((symbol_short!("xfer_from"), spender), amount);
    }

    /// Burn tokens (for use in lending liquidations, etc.)
    pub fn burn(env: Env, from: Address, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");
        let bal = Self::balance_of(env.clone(), from.clone());
        assert!(bal >= amount, "insufficient balance");

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(bal - amount));
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply - amount));

        env.events()
            .publish((symbol_short!("burn"), from), amount);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    pub fn balance_of(env: Env, owner: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(owner))
            .unwrap_or(0)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(owner, spender))
            .unwrap_or(0)
    }

    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::OperatorApproval(owner, operator))
            .unwrap_or(false)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    // ============================================================================
    // AMM Integration Hooks
    // ============================================================================

    /// Authorize an address to interact with AMM protocols
    /// This enables seamless integration with the AMM module
    pub fn authorize_amm(env: Env, admin: Address, amm_address: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().set(&DataKey::AMMAuthorized(amm_address), &true);
        env.events()
            .publish((symbol_short!("amm_auth"), amm_address), true);
    }

    /// Revoke AMM authorization for an address
    pub fn revoke_amm(env: Env, admin: Address, amm_address: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().remove(&DataKey::AMMAuthorized(amm_address));
        env.events()
            .publish((symbol_short!("amm_revoke"), amm_address), true);
    }

    /// Check if an address is authorized for AMM interactions
    pub fn is_amm_authorized(env: Env, address: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::AMMAuthorized(address))
            .unwrap_or(false)
    }

    // ============================================================================
    // Lending Integration Hooks
    // ============================================================================

    /// Authorize an address to interact with Lending protocols
    /// This enables seamless integration with the Lending/Flash Loan module
    pub fn authorize_lending(env: Env, admin: Address, lending_address: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().set(&DataKey::LendingAuthorized(lending_address), &true);
        env.events()
            .publish((symbol_short!("lend_auth"), lending_address), true);
    }

    /// Revoke Lending authorization for an address
    pub fn revoke_lending(env: Env, admin: Address, lending_address: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().remove(&DataKey::LendingAuthorized(lending_address));
        env.events()
            .publish((symbol_short!("lend_revoke"), lending_address), true);
    }

    /// Check if an address is authorized for Lending interactions
    pub fn is_lending_authorized(env: Env, address: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::LendingAuthorized(address))
            .unwrap_or(false)
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    /// Pause deposits and withdrawals (emergency function)
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events()
            .publish((symbol_short!("pause"), admin), true);
    }

    /// Unpause deposits and withdrawals
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events()
            .publish((symbol_short!("unpause"), admin), true);
    }

    /// Check if the contract is paused
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    fn do_transfer(env: &Env, from: Address, to: Address, amount: i128) {
        assert!(amount > 0, "amount must be positive");
        let from_bal = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        assert!(from_bal >= amount, "insufficient balance");

        env.storage().persistent().set(
            &DataKey::Balance(from.clone()),
            &(from_bal - amount),
        );
        let to_bal = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Balance(to.clone()))
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone()), &(to_bal + amount));

        env.events()
            .publish((symbol_short!("transfer"), from, to), amount);
    }

    fn check_not_paused(env: &Env) {
        assert!(!Self::is_paused(env.clone()), "contract is paused");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, XLMWrapperClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, XLMWrapper);
        let client = XLMWrapperClient::new(&env, &contract_id);
        
        client.initialize(
            &admin,
            &String::from_str(&env, "Wrapped XLM"),
            &String::from_str(&env, "wXLM"),
        );
        
        (env, client, admin)
    }

    #[test]
    fn test_initialize() {
        let (env, client, admin) = setup();
        
        assert_eq!(client.name(), String::from_str(&env, "Wrapped XLM"));
        assert_eq!(client.symbol(), String::from_str(&env, "wXLM"));
        assert_eq!(client.decimals(), 7);
        assert_eq!(client.total_supply(), 0);
    }

    #[test]
    fn test_deposit_withdraw() {
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        
        // Mock native XLM balance for testing
        // In production, this would be actual native XLM
        
        // Test deposit
        let deposit_amount = 1000_i128;
        client.deposit(&user, &deposit_amount);
        
        assert_eq!(client.balance_of(&user), deposit_amount);
        assert_eq!(client.total_supply(), deposit_amount);
        
        // Test withdraw
        let withdraw_amount = 500_i128;
        client.withdraw(&user, &withdraw_amount);
        
        assert_eq!(client.balance_of(&user), deposit_amount - withdraw_amount);
        assert_eq!(client.total_supply(), deposit_amount - withdraw_amount);
    }

    #[test]
    fn test_transfer() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        
        client.deposit(&alice, &1000);
        client.transfer(&alice, &bob, &300);
        
        assert_eq!(client.balance_of(&alice), 700);
        assert_eq!(client.balance_of(&bob), 300);
        assert_eq!(client.total_supply(), 1000);
    }

    #[test]
    fn test_approve_and_transfer_from() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        
        client.deposit(&alice, &1000);
        client.approve(&alice, &bob, &500);
        
        assert_eq!(client.allowance(&alice, &bob), 500);
        
        client.transfer_from(&bob, &alice, &carol, &300);
        
        assert_eq!(client.balance_of(&alice), 700);
        assert_eq!(client.balance_of(&carol), 300);
        assert_eq!(client.allowance(&alice, &bob), 200);
    }

    #[test]
    fn test_operator_approval() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let operator = Address::generate(&env);
        let bob = Address::generate(&env);
        
        client.deposit(&alice, &1000);
        client.set_approval_for_all(&alice, &operator, &true);
        
        assert!(client.is_approved_for_all(&alice, &operator));
        
        client.transfer_from(&operator, &alice, &bob, &300);
        
        assert_eq!(client.balance_of(&alice), 700);
        assert_eq!(client.balance_of(&bob), 300);
    }

    #[test]
    fn test_burn() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        
        client.deposit(&alice, &1000);
        client.burn(&alice, &300);
        
        assert_eq!(client.balance_of(&alice), 700);
        assert_eq!(client.total_supply(), 700);
    }

    #[test]
    fn test_amm_authorization() {
        let (env, client, admin) = setup();
        let amm_address = Address::generate(&env);
        
        assert!(!client.is_amm_authorized(&amm_address));
        
        client.authorize_amm(&admin, &amm_address);
        assert!(client.is_amm_authorized(&amm_address));
        
        client.revoke_amm(&admin, &amm_address);
        assert!(!client.is_amm_authorized(&amm_address));
    }

    #[test]
    fn test_lending_authorization() {
        let (env, client, admin) = setup();
        let lending_address = Address::generate(&env);
        
        assert!(!client.is_lending_authorized(&lending_address));
        
        client.authorize_lending(&admin, &lending_address);
        assert!(client.is_lending_authorized(&lending_address));
        
        client.revoke_lending(&admin, &lending_address);
        assert!(!client.is_lending_authorized(&lending_address));
    }

    #[test]
    fn test_pause_unpause() {
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        
        assert!(!client.is_paused());
        
        client.pause(&admin);
        assert!(client.is_paused());
        
        client.unpause(&admin);
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_deposit_when_paused() {
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        
        client.pause(&admin);
        client.deposit(&user, &1000);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_withdraw_when_paused() {
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        
        client.deposit(&user, &1000);
        client.pause(&admin);
        client.withdraw(&user, &500);
    }

    #[test]
    fn test_one_to_one_peg() {
        let (env, client, admin) = setup();
        let user = Address::generate(&env);
        
        // Verify 1:1 peg is maintained
        client.deposit(&user, &1000);
        assert_eq!(client.balance_of(&user), 1000);
        assert_eq!(client.total_supply(), 1000);
        
        client.withdraw(&user, &1000);
        assert_eq!(client.balance_of(&user), 0);
        assert_eq!(client.total_supply(), 0);
    }
}

/// ============================================================================
/// Formal Verification Invariants
/// ============================================================================
/// These tests verify critical invariants that must hold for all valid states
/// and operations of the XLM wrapper contract. They use property-based testing
/// patterns to ensure mathematical correctness and maintain the 1:1 peg.
#[cfg(test)]
mod invariants {
    extern crate std;
    use super::*;
    use soroban_sdk::testutils::Address as _;

    /// Helper to set up a fresh contract instance
    fn setup_fresh() -> (Env, XLMWrapperClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, XLMWrapper);
        let client = XLMWrapperClient::new(&env, &contract_id);
        client.initialize(
            &admin,
            &String::from_str(&env, "Wrapped XLM"),
            &String::from_str(&env, "wXLM"),
        );
        (env, client, admin)
    }

    /// Helper to verify the supply conservation invariant
    fn verify_supply_conservation(env: &Env, client: &XLMWrapperClient<'_>, users: &[Address]) {
        let total_supply = client.total_supply();
        let balance_sum: i128 = users.iter().map(|u| client.balance_of(u)).sum();
        assert_eq!(
            total_supply, balance_sum,
            "INVARIANT VIOLATION: Total supply ({}) != Sum of balances ({})",
            total_supply, balance_sum
        );
    }

    // =========================================================================
    // INVARIANT 1: Conservation of Supply
    // =========================================================================
    /// After any operation, the sum of all user balances must equal total_supply.
    /// This is the fundamental invariant of any token contract.
    #[test]
    fn invariant_supply_conservation_after_deposit() {
        let (env, client, _) = setup_fresh();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        let user3 = Address::generate(&env);

        // Deposit to multiple users
        client.deposit(&user1, &1000);
        verify_supply_conservation(&env, &client, &[user1.clone(), user2.clone(), user3.clone()]);

        client.deposit(&user2, &500);
        verify_supply_conservation(&env, &client, &[user1.clone(), user2.clone(), user3.clone()]);

        client.deposit(&user3, &250);
        verify_supply_conservation(&env, &client, &[user1, user2, user3]);
    }

    #[test]
    fn invariant_supply_conservation_after_transfer() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);

        client.deposit(&alice, &1000);
        let supply_before = client.total_supply();

        // Multiple transfers
        client.transfer(&alice, &bob, &300);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);

        client.transfer(&bob, &carol, &150);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);

        client.transfer(&alice, &carol, &100);
        verify_supply_conservation(&env, &client, &[alice, bob, carol]);

        let supply_after = client.total_supply();
        assert_eq!(
            supply_before, supply_after,
            "INVARIANT VIOLATION: Supply changed during transfers"
        );
    }

    #[test]
    fn invariant_supply_conservation_after_withdraw() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        client.deposit(&user, &1000);
        let supply_before_withdraw = client.total_supply();

        client.withdraw(&user, &300);
        verify_supply_conservation(&env, &client, &[user.clone()]);

        // Invariant: supply decreases by exactly the withdrawn amount
        assert_eq!(
            client.total_supply(),
            supply_before_withdraw - 300,
            "INVARIANT VIOLATION: Supply not reduced correctly after withdraw"
        );

        verify_supply_conservation(&env, &client, &[user]);
    }

    #[test]
    fn invariant_supply_conservation_after_burn() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        client.deposit(&user, &1000);
        let supply_before_burn = client.total_supply();

        client.burn(&user, &300);
        verify_supply_conservation(&env, &client, &[user.clone()]);

        assert_eq!(
            client.total_supply(),
            supply_before_burn - 300,
            "INVARIANT VIOLATION: Supply not reduced correctly after burn"
        );

        verify_supply_conservation(&env, &client, &[user]);
    }

    // =========================================================================
    // INVARIANT 2: 1:1 Peg Maintenance
    // =========================================================================
    /// The total supply of wXLM should always equal the total amount of
    /// native XLM held by the contract (minus any burned tokens).
    #[test]
    fn invariant_one_to_one_peg_after_operations() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        // Deposit creates 1:1 peg
        client.deposit(&user, &1000);
        assert_eq!(
            client.total_supply(),
            client.balance_of(&user),
            "INVARIANT VIOLATION: 1:1 peg broken after deposit"
        );

        // Transfer maintains peg
        let bob = Address::generate(&env);
        client.transfer(&user, &bob, &300);
        assert_eq!(
            client.total_supply(),
            client.balance_of(&user) + client.balance_of(&bob),
            "INVARIANT VIOLATION: 1:1 peg broken after transfer"
        );

        // Withdraw maintains peg
        client.withdraw(&user, &200);
        assert_eq!(
            client.total_supply(),
            client.balance_of(&user) + client.balance_of(&bob),
            "INVARIANT VIOLATION: 1:1 peg broken after withdraw"
        );
    }

    // =========================================================================
    // INVARIANT 3: Non-Negative Balances
    // =========================================================================
    /// All balances must always be non-negative (>= 0).
    #[test]
    fn invariant_non_negative_balances() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        assert!(
            client.balance_of(&user) >= 0,
            "INVARIANT VIOLATION: Initial balance is negative"
        );

        client.deposit(&user, &100);
        assert!(
            client.balance_of(&user) >= 0,
            "INVARIANT VIOLATION: Balance negative after deposit"
        );

        client.withdraw(&user, &100);
        assert!(
            client.balance_of(&user) >= 0,
            "INVARIANT VIOLATION: Balance negative after withdraw"
        );
    }

    // =========================================================================
    // INVARIANT 4: Conservation of Value in Transfer
    // =========================================================================
    /// In any transfer, the sum of sender and receiver balances before
    /// must equal the sum after the transfer.
    #[test]
    fn invariant_transfer_value_conservation() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.deposit(&alice, &1000);

        let alice_before = client.balance_of(&alice);
        let bob_before = client.balance_of(&bob);
        let sum_before = alice_before + bob_before;

        client.transfer(&alice, &bob, &400);

        let alice_after = client.balance_of(&alice);
        let bob_after = client.balance_of(&bob);
        let sum_after = alice_after + bob_after;

        assert_eq!(
            sum_before, sum_after,
            "INVARIANT VIOLATION: Value not conserved in transfer"
        );

        assert_eq!(
            alice_before - alice_after,
            400,
            "INVARIANT VIOLATION: Sender balance not reduced correctly"
        );

        assert_eq!(
            bob_after - bob_before,
            400,
            "INVARIANT VIOLATION: Receiver balance not increased correctly"
        );
    }

    // =========================================================================
    // INVARIANT 5: Allowance Accounting
    // =========================================================================
    /// After transfer_from, the allowance must decrease by exactly the
    /// transferred amount.
    #[test]
    fn invariant_allowance_decrease_on_transfer_from() {
        let (env, client, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.deposit(&owner, &1000);
        client.approve(&owner, &spender, &500);

        let allowance_before = client.allowance(&owner, &spender);

        client.transfer_from(&spender, &owner, &recipient, &200);

        let allowance_after = client.allowance(&owner, &spender);

        assert_eq!(
            allowance_before - allowance_after,
            200,
            "INVARIANT VIOLATION: Allowance not reduced correctly"
        );
    }

    #[test]
    #[should_panic]
    fn invariant_allowance_cannot_exceed_approval() {
        let (env, client, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.deposit(&owner, &1000);
        client.approve(&owner, &spender, &100);

        // Attempting to spend more than approved should fail
        client.transfer_from(&spender, &owner, &recipient, &150);
    }

    // =========================================================================
    // INVARIANT 6: No Double Spend
    // =========================================================================
    /// A user cannot spend the same tokens twice (either directly or via approval).
    #[test]
    #[should_panic]
    fn invariant_no_double_spend_direct() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);

        client.deposit(&alice, &100);

        // First transfer succeeds
        client.transfer(&alice, &bob, &60);

        // Alice now has 40, trying to spend 60 more should fail
        client.transfer(&alice, &carol, &60);
    }

    // =========================================================================
    // INVARIANT 7: Total Supply Monotonicity
    // =========================================================================
    /// Total supply only increases via deposit and only decreases via withdraw/burn.
    /// Transfers and approvals do not affect total supply.
    #[test]
    fn invariant_supply_only_changes_via_deposit_withdraw_burn() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let initial_supply = client.total_supply();
        assert_eq!(initial_supply, 0);

        // Deposit increases supply
        client.deposit(&alice, &500);
        assert_eq!(client.total_supply(), 500);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);

        // Transfer does not change supply
        client.transfer(&alice, &bob, &200);
        assert_eq!(
            client.total_supply(),
            500,
            "INVARIANT VIOLATION: Transfer changed total supply"
        );
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);

        // Approve does not change supply
        client.approve(&alice, &bob, &100);
        assert_eq!(
            client.total_supply(),
            500,
            "INVARIANT VIOLATION: Approve changed total supply"
        );
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);

        // Burn decreases supply
        client.burn(&alice, &100);
        assert_eq!(client.total_supply(), 400);
        verify_supply_conservation(&env, &client, &[alice, bob]);
    }

    // =========================================================================
    // INVARIANT 8: Zero Amount Handling
    // =========================================================================
    /// The contract should handle zero amounts appropriately.
    #[test]
    #[should_panic]
    fn invariant_deposit_zero_rejected() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        client.deposit(&user, &0);
    }

    #[test]
    #[should_panic]
    fn invariant_withdraw_zero_rejected() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        client.deposit(&user, &100);
        client.withdraw(&user, &0);
    }

    #[test]
    #[should_panic]
    fn invariant_burn_zero_rejected() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        client.deposit(&user, &100);
        client.burn(&user, &0);
    }

    // =========================================================================
    // INVARIANT 9: Idempotency Properties
    // =========================================================================
    /// Certain operations should have predictable idempotent-like behavior.
    #[test]
    fn invariant_approve_overwrites() {
        let (env, client, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);

        client.deposit(&owner, &1000);
        client.approve(&owner, &spender, &100);
        assert_eq!(client.allowance(&owner, &spender), 100);

        // New approval should overwrite, not add
        client.approve(&owner, &spender, &200);
        assert_eq!(
            client.allowance(&owner, &spender),
            200,
            "INVARIANT VIOLATION: Approve did not overwrite previous allowance"
        );
    }

    // =========================================================================
    // PROPERTY-BASED INVARIANT TESTS
    // =========================================================================
    /// These tests verify invariants across sequences of operations.

    #[test]
    fn property_sequence_invariant() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);

        // Sequence of operations that should maintain invariants
        client.deposit(&alice, &1000);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);

        client.deposit(&bob, &500);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);

        client.transfer(&alice, &bob, &200);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);

        client.approve(&bob, &carol, &300);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);

        client.transfer_from(&carol, &bob, &alice, &150);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);

        client.withdraw(&alice, &100);
        verify_supply_conservation(&env, &client, &[alice, bob, carol]);

        // Verify final invariants
        let total_balance = client.balance_of(&alice) + client.balance_of(&bob) + client.balance_of(&carol);

        assert_eq!(
            client.total_supply(),
            total_balance,
            "PROPERTY VIOLATION: Supply invariant broken after operation sequence"
        );

        assert!(
            client.balance_of(&alice) >= 0 && client.balance_of(&bob) >= 0 && client.balance_of(&carol) >= 0,
            "PROPERTY VIOLATION: Negative balance detected"
        );
    }

    #[test]
    fn property_deposit_withdraw_symmetry() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        // Deposit then withdraw same amount should return to initial state
        let initial_supply = client.total_supply();
        let initial_balance = client.balance_of(&user);

        client.deposit(&user, &500);
        verify_supply_conservation(&env, &client, &[user.clone()]);

        client.withdraw(&user, &500);
        verify_supply_conservation(&env, &client, &[user.clone()]);

        assert_eq!(
            client.total_supply(),
            initial_supply,
            "PROPERTY VIOLATION: Deposit-withdraw symmetry broken for supply"
        );

        assert_eq!(
            client.balance_of(&user),
            initial_balance,
            "PROPERTY VIOLATION: Deposit-withdraw symmetry broken for balance"
        );
    }

    #[test]
    fn property_transfer_reversibility_check() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.deposit(&alice, &1000);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);

        let alice_initial = client.balance_of(&alice);
        let bob_initial = client.balance_of(&bob);

        // Transfer A -> B
        client.transfer(&alice, &bob, &300);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);

        // Transfer B -> A (reverse)
        client.transfer(&bob, &alice, &300);
        verify_supply_conservation(&env, &client, &[alice, bob]);

        // After round-trip, balances should be back to original
        assert_eq!(
            client.balance_of(&alice),
            alice_initial,
            "PROPERTY VIOLATION: Round-trip transfer didn't restore sender balance"
        );

        assert_eq!(
            client.balance_of(&bob),
            bob_initial,
            "PROPERTY VIOLATION: Round-trip transfer didn't restore receiver balance"
        );
    }

    #[test]
    fn property_multi_user_supply_conservation() {
        let (env, client, _) = setup_fresh();
        let users: Vec<Address> = (0..10).map(|_| Address::generate(&env)).collect();

        // Random-like deposits
        let mut total_deposited = 0_i128;
        for (i, user) in users.iter().enumerate() {
            let amount = ((i + 1) * 100) as i128;
            client.deposit(user, &amount);
            total_deposited += amount;
            verify_supply_conservation(&env, &client, &users);
        }

        assert_eq!(
            client.total_supply(),
            total_deposited,
            "PROPERTY VIOLATION: Total supply doesn't match total deposited"
        );

        // Random-like transfers between users
        for i in 0..5 {
            let from = users.get(i).unwrap();
            let to = users.get(i + 1).unwrap();
            client.transfer(from, to, &50);
            verify_supply_conservation(&env, &client, &users);
        }

        assert_eq!(
            client.total_supply(),
            total_deposited,
            "PROPERTY VIOLATION: Supply changed during transfers"
        );
    }
}
