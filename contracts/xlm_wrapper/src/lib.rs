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
    NativeAsset,
    Token,
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
    /// * `token` - Address of the wXLM token contract
    /// * `native_asset` - Address of the native XLM token contract
    pub fn initialize(env: Env, admin: Address, token: Address, name: String, symbol: String, native_asset: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::Decimals, &7u32); // XLM uses 7 decimals
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::NativeAsset, &native_asset);
        
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
        let native_asset: Address = env.storage().instance().get(&DataKey::NativeAsset).expect("native asset not set");
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &native_asset)
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
        let native_asset: Address = env.storage().instance().get(&DataKey::NativeAsset).expect("native asset not set");
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &native_asset)
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

    /// Decrease the allowance granted to a spender
    pub fn decrease_allowance(env: Env, owner: Address, spender: Address, amount: i128) {
        owner.require_auth();
        assert!(amount >= 0, "amount must be non-negative");
        let current = Self::allowance(env.clone(), owner.clone(), spender.clone());
        assert!(amount <= current, "insufficient allowance");
        let new_allowance = current - amount;
        env.storage().persistent().set(
            &DataKey::Allowance(owner.clone(), spender.clone()),
            &new_allowance,
        );
        env.events()
            .publish((symbol_short!("dec_allow"), owner, spender), new_allowance);
    }

    /// Increase the allowance granted to a spender
    pub fn increase_allowance(env: Env, owner: Address, spender: Address, amount: i128) {
        owner.require_auth();
        assert!(amount >= 0, "amount must be non-negative");
        let current = Self::allowance(env.clone(), owner.clone(), spender.clone());
        let new_allowance = current + amount;
        env.storage().persistent().set(
            &DataKey::Allowance(owner.clone(), spender.clone()),
            &new_allowance,
        );
        env.events()
            .publish((symbol_short!("inc_allow"), owner, spender), new_allowance);
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

    /// Standard token-style balance accessor.
    ///
    /// This is an alias for `balance_of` so consumers that expect the common
    /// Soroban token shape can use the wrapper without adapter code.
    pub fn balance(env: Env, owner: Address) -> i128 {
        Self::balance_of(env, owner)
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
        
        env.storage().instance().set(&DataKey::AMMAuthorized(amm_address.clone()), &true);
        env.events()
            .publish((symbol_short!("amm_auth"), amm_address), true);
    }

    /// Revoke AMM authorization for an address
    pub fn revoke_amm(env: Env, admin: Address, amm_address: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().remove(&DataKey::AMMAuthorized(amm_address.clone()));
        env.events()
            .publish((soroban_sdk::Symbol::new(&env, "amm_revoke"), amm_address), true);
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
        
        env.storage().instance().set(&DataKey::LendingAuthorized(lending_address.clone()), &true);
        env.events()
            .publish((symbol_short!("lend_auth"), lending_address), true);
    }

    /// Revoke Lending authorization for an address
    pub fn revoke_lending(env: Env, admin: Address, lending_address: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().remove(&DataKey::LendingAuthorized(lending_address.clone()));
        env.events()
            .publish((soroban_sdk::Symbol::new(&env, "lend_revoke"), lending_address.clone()), true);
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
    use soroban_sdk::token::StellarAssetClient;

    struct TestEnv {
        env: Env,
        client: XLMWrapperClient<'static>,
        sac: StellarAssetClient<'static>,
        admin: Address,
    }

    fn setup() -> TestEnv {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        let sac_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let native_asset = sac_contract.address();
        let sac = StellarAssetClient::new(&env, &native_asset);
        
        let contract_id = env.register_contract(None, XLMWrapper);
        let client = XLMWrapperClient::new(&env, &contract_id);
        
        let token = Address::generate(&env);
        client.initialize(
            &admin,
            &token,
            &String::from_str(&env, "Wrapped XLM"),
            &String::from_str(&env, "wXLM"),
            &native_asset,
        );
        
        TestEnv { env, client, sac, admin }
    }

    fn fund_user(te: &TestEnv, user: &Address, amount: i128) {
        te.sac.mint(user, &amount);
    }

    #[test]
    fn test_initialize() {
        let te = setup();
        
        assert_eq!(te.client.name(), String::from_str(&te.env, "Wrapped XLM"));
        assert_eq!(te.client.symbol(), String::from_str(&te.env, "wXLM"));
        assert_eq!(te.client.decimals(), 7);
        assert_eq!(te.client.total_supply(), 0);
    }

    #[test]
    fn test_deposit_withdraw() {
        let te = setup();
        let user = Address::generate(&te.env);
        
        fund_user(&te, &user, 1000);
        te.client.deposit(&user, &1000);
        
        assert_eq!(te.client.balance_of(&user), 1000);
        assert_eq!(te.client.total_supply(), 1000);
        
        te.client.withdraw(&user, &500);
        
        assert_eq!(te.client.balance_of(&user), 500);
        assert_eq!(te.client.total_supply(), 500);
    }

    #[test]
    fn test_transfer() {
        let te = setup();
        let alice = Address::generate(&te.env);
        let bob = Address::generate(&te.env);
        
        fund_user(&te, &alice, 1000);
        te.client.deposit(&alice, &1000);
        te.client.transfer(&alice, &bob, &300);
        
        assert_eq!(te.client.balance_of(&alice), 700);
        assert_eq!(te.client.balance_of(&bob), 300);
        assert_eq!(te.client.total_supply(), 1000);
    }

    #[test]
    fn test_approve_and_transfer_from() {
        let te = setup();
        let alice = Address::generate(&te.env);
        let bob = Address::generate(&te.env);
        let carol = Address::generate(&te.env);
        
        fund_user(&te, &alice, 1000);
        te.client.deposit(&alice, &1000);
        te.client.approve(&alice, &bob, &500);
        
        assert_eq!(te.client.allowance(&alice, &bob), 500);
        
        te.client.transfer_from(&bob, &alice, &carol, &300);
        
        assert_eq!(te.client.balance_of(&alice), 700);
        assert_eq!(te.client.balance_of(&carol), 300);
        assert_eq!(te.client.allowance(&alice, &bob), 200);
    }

    #[test]
    fn test_decrease_allowance() {
        let te = setup();
        let owner = Address::generate(&te.env);
        let spender = Address::generate(&te.env);

        fund_user(&te, &owner, 1000);
        te.client.deposit(&owner, &1000);
        te.client.approve(&owner, &spender, &500);

        assert_eq!(te.client.allowance(&owner, &spender), 500);

        te.client.decrease_allowance(&owner, &spender, &200);

        assert_eq!(te.client.allowance(&owner, &spender), 300);
    }

    #[test]
    fn test_decrease_allowance_to_zero() {
        let te = setup();
        let owner = Address::generate(&te.env);
        let spender = Address::generate(&te.env);

        fund_user(&te, &owner, 1000);
        te.client.deposit(&owner, &1000);
        te.client.approve(&owner, &spender, &300);
        te.client.decrease_allowance(&owner, &spender, &300);

        assert_eq!(te.client.allowance(&owner, &spender), 0);
    }

    #[test]
    #[should_panic(expected = "insufficient allowance")]
    fn test_decrease_allowance_exceeding_balance() {
        let te = setup();
        let owner = Address::generate(&te.env);
        let spender = Address::generate(&te.env);

        fund_user(&te, &owner, 1000);
        te.client.deposit(&owner, &1000);
        te.client.approve(&owner, &spender, &300);
        te.client.decrease_allowance(&owner, &spender, &500);
    }

    #[test]
    #[should_panic(expected = "insufficient allowance")]
    fn test_decrease_allowance_from_zero() {
        let te = setup();
        let owner = Address::generate(&te.env);
        let spender = Address::generate(&te.env);

        fund_user(&te, &owner, 1000);
        te.client.deposit(&owner, &1000);

        // Decreasing from zero allowance should fail
        te.client.decrease_allowance(&owner, &spender, &100);
    }

    #[test]
    fn test_increase_allowance() {
        let te = setup();
        let owner = Address::generate(&te.env);
        let spender = Address::generate(&te.env);

        fund_user(&te, &owner, 1000);
        te.client.deposit(&owner, &1000);
        te.client.approve(&owner, &spender, &300);

        assert_eq!(te.client.allowance(&owner, &spender), 300);

        te.client.increase_allowance(&owner, &spender, &200);

        assert_eq!(te.client.allowance(&owner, &spender), 500);
    }

    #[test]
    fn test_increase_allowance_from_zero() {
        let te = setup();
        let owner = Address::generate(&te.env);
        let spender = Address::generate(&te.env);

        fund_user(&te, &owner, 1000);
        te.client.deposit(&owner, &1000);

        te.client.increase_allowance(&owner, &spender, &300);

        assert_eq!(te.client.allowance(&owner, &spender), 300);
    }

    #[test]
    #[should_panic(expected = "amount must be non-negative")]
    fn test_decrease_allowance_negative_amount() {
        let te = setup();
        let owner = Address::generate(&te.env);
        let spender = Address::generate(&te.env);

        fund_user(&te, &owner, 1000);
        te.client.deposit(&owner, &1000);
        te.client.approve(&owner, &spender, &500);
        te.client.decrease_allowance(&owner, &spender, &-100);
    }

    #[test]
    fn test_allowance_combined_operations() {
        let te = setup();
        let owner = Address::generate(&te.env);
        let spender = Address::generate(&te.env);

        fund_user(&te, &owner, 1000);
        te.client.deposit(&owner, &1000);

        // Approve, then increase, then decrease, then transfer_from
        te.client.approve(&owner, &spender, &200);
        assert_eq!(te.client.allowance(&owner, &spender), 200);

        te.client.increase_allowance(&owner, &spender, &100);
        assert_eq!(te.client.allowance(&owner, &spender), 300);

        te.client.decrease_allowance(&owner, &spender, &50);
        assert_eq!(te.client.allowance(&owner, &spender), 250);

        let recipient = Address::generate(&te.env);
        te.client.transfer_from(&spender, &owner, &recipient, &100);
        assert_eq!(te.client.allowance(&owner, &spender), 150);
        assert_eq!(te.client.balance_of(&owner), 900);
        assert_eq!(te.client.balance_of(&recipient), 100);
    }

    #[test]
    fn test_operator_approval() {
        let te = setup();
        let alice = Address::generate(&te.env);
        let operator = Address::generate(&te.env);
        let bob = Address::generate(&te.env);
        
        fund_user(&te, &alice, 1000);
        te.client.deposit(&alice, &1000);
        te.client.set_approval_for_all(&alice, &operator, &true);
        
        assert!(te.client.is_approved_for_all(&alice, &operator));
        
        te.client.transfer_from(&operator, &alice, &bob, &300);
        
        assert_eq!(te.client.balance_of(&alice), 700);
        assert_eq!(te.client.balance_of(&bob), 300);
    }

    #[test]
    fn test_burn() {
        let te = setup();
        let alice = Address::generate(&te.env);
        
        fund_user(&te, &alice, 1000);
        te.client.deposit(&alice, &1000);
        te.client.burn(&alice, &300);
        
        assert_eq!(te.client.balance_of(&alice), 700);
        assert_eq!(te.client.total_supply(), 700);
    }

    #[test]
    fn test_amm_authorization() {
        let te = setup();
        let amm_address = Address::generate(&te.env);
        
        assert!(!te.client.is_amm_authorized(&amm_address));
        
        te.client.authorize_amm(&te.admin, &amm_address);
        assert!(te.client.is_amm_authorized(&amm_address));
        
        te.client.revoke_amm(&te.admin, &amm_address);
        assert!(!te.client.is_amm_authorized(&amm_address));
    }

    #[test]
    fn test_lending_authorization() {
        let te = setup();
        let lending_address = Address::generate(&te.env);
        
        assert!(!te.client.is_lending_authorized(&lending_address));
        
        te.client.authorize_lending(&te.admin, &lending_address);
        assert!(te.client.is_lending_authorized(&lending_address));
        
        te.client.revoke_lending(&te.admin, &lending_address);
        assert!(!te.client.is_lending_authorized(&lending_address));
    }

    #[test]
    fn test_pause_unpause() {
        let te = setup();
        let user = Address::generate(&te.env);
        
        assert!(!te.client.is_paused());
        
        te.client.pause(&te.admin);
        assert!(te.client.is_paused());
        
        te.client.unpause(&te.admin);
        assert!(!te.client.is_paused());
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_deposit_when_paused() {
        let te = setup();
        let user = Address::generate(&te.env);
        
        te.client.pause(&te.admin);
        te.client.deposit(&user, &1000);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_withdraw_when_paused() {
        let te = setup();
        let user = Address::generate(&te.env);
        
        fund_user(&te, &user, 1000);
        te.client.deposit(&user, &1000);
        te.client.pause(&te.admin);
        te.client.withdraw(&user, &500);
    }

    #[test]
    fn test_one_to_one_peg() {
        let te = setup();
        let user = Address::generate(&te.env);
        
        // Verify 1:1 peg is maintained
        fund_user(&te, &user, 1000);
        te.client.deposit(&user, &1000);
        assert_eq!(te.client.balance_of(&user), 1000);
        assert_eq!(te.client.total_supply(), 1000);
        
        te.client.withdraw(&user, &1000);
        assert_eq!(te.client.balance_of(&user), 0);
        assert_eq!(te.client.total_supply(), 0);
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
    use soroban_sdk::token::StellarAssetClient;

    fn fund_user(env: &Env, sac: &StellarAssetClient<'_>, user: &Address, amount: i128) {
        sac.mint(user, &amount);
    }

    fn fund_and_deposit(env: &Env, sac: &StellarAssetClient<'_>, client: &XLMWrapperClient<'_>, user: &Address, amount: i128) {
        fund_user(env, sac, user, amount);
        client.deposit(user, &amount);
    }

    fn setup_fresh() -> (Env, XLMWrapperClient<'static>, StellarAssetClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let sac_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let native_asset = sac_contract.address();
        let sac = StellarAssetClient::new(&env, &native_asset);
        let contract_id = env.register_contract(None, XLMWrapper);
        let client = XLMWrapperClient::new(&env, &contract_id);
        let token = Address::generate(&env);
        client.initialize(
            &admin,
            &token,
            &String::from_str(&env, "Wrapped XLM"),
            &String::from_str(&env, "wXLM"),
            &native_asset,
        );
        (env, client, sac, admin)
    }

    fn verify_supply_conservation(env: &Env, client: &XLMWrapperClient<'_>, users: &[Address]) {
        let total_supply = client.total_supply();
        let balance_sum: i128 = users.iter().map(|u| client.balance_of(u)).sum();
        assert_eq!(
            total_supply, balance_sum,
            "INVARIANT VIOLATION: Total supply ({}) != Sum of balances ({})",
            total_supply, balance_sum
        );
    }

    #[test]
    fn invariant_supply_conservation_after_deposit() {
        let (env, client, sac, _) = setup_fresh();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        let user3 = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &user1, 1000);
        verify_supply_conservation(&env, &client, &[user1.clone(), user2.clone(), user3.clone()]);
        fund_and_deposit(&env, &sac, &client, &user2, 500);
        verify_supply_conservation(&env, &client, &[user1.clone(), user2.clone(), user3.clone()]);
        fund_and_deposit(&env, &sac, &client, &user3, 250);
        verify_supply_conservation(&env, &client, &[user1, user2, user3]);
    }

    #[test]
    fn invariant_supply_conservation_after_transfer() {
        let (env, client, sac, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &alice, 1000);
        let supply_before = client.total_supply();
        client.transfer(&alice, &bob, &300);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);
        client.transfer(&bob, &carol, &150);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);
        client.transfer(&alice, &carol, &100);
        verify_supply_conservation(&env, &client, &[alice, bob, carol]);
        let supply_after = client.total_supply();
        assert_eq!(supply_before, supply_after, "INVARIANT VIOLATION: Supply changed during transfers");
    }

    #[test]
    fn invariant_supply_conservation_after_withdraw() {
        let (env, client, sac, _) = setup_fresh();
        let user = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &user, 1000);
        let supply_before_withdraw = client.total_supply();
        client.withdraw(&user, &300);
        verify_supply_conservation(&env, &client, &[user.clone()]);
        assert_eq!(client.total_supply(), supply_before_withdraw - 300, "INVARIANT VIOLATION: Supply not reduced correctly after withdraw");
        verify_supply_conservation(&env, &client, &[user]);
    }

    #[test]
    fn invariant_supply_conservation_after_burn() {
        let (env, client, sac, _) = setup_fresh();
        let user = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &user, 1000);
        let supply_before_burn = client.total_supply();
        client.burn(&user, &300);
        verify_supply_conservation(&env, &client, &[user.clone()]);
        assert_eq!(client.total_supply(), supply_before_burn - 300, "INVARIANT VIOLATION: Supply not reduced correctly after burn");
        verify_supply_conservation(&env, &client, &[user]);
    }

    #[test]
    fn invariant_one_to_one_peg_after_operations() {
        let (env, client, sac, _) = setup_fresh();
        let user = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &user, 1000);
        assert_eq!(client.total_supply(), client.balance_of(&user), "INVARIANT VIOLATION: 1:1 peg broken after deposit");
        let bob = Address::generate(&env);
        client.transfer(&user, &bob, &300);
        assert_eq!(client.total_supply(), client.balance_of(&user) + client.balance_of(&bob), "INVARIANT VIOLATION: 1:1 peg broken after transfer");
        client.withdraw(&user, &200);
        assert_eq!(client.total_supply(), client.balance_of(&user) + client.balance_of(&bob), "INVARIANT VIOLATION: 1:1 peg broken after withdraw");
    }

    #[test]
    fn invariant_non_negative_balances() {
        let (env, client, sac, _) = setup_fresh();
        let user = Address::generate(&env);
        assert!(client.balance_of(&user) >= 0, "INVARIANT VIOLATION: Initial balance is negative");
        fund_and_deposit(&env, &sac, &client, &user, 100);
        assert!(client.balance_of(&user) >= 0, "INVARIANT VIOLATION: Balance negative after deposit");
        client.withdraw(&user, &100);
        assert!(client.balance_of(&user) >= 0, "INVARIANT VIOLATION: Balance negative after withdraw");
    }

    #[test]
    fn invariant_transfer_value_conservation() {
        let (env, client, sac, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &alice, 1000);
        let alice_before = client.balance_of(&alice);
        let bob_before = client.balance_of(&bob);
        let sum_before = alice_before + bob_before;
        client.transfer(&alice, &bob, &400);
        let alice_after = client.balance_of(&alice);
        let bob_after = client.balance_of(&bob);
        let sum_after = alice_after + bob_after;
        assert_eq!(sum_before, sum_after, "INVARIANT VIOLATION: Value not conserved in transfer");
        assert_eq!(alice_before - alice_after, 400, "INVARIANT VIOLATION: Sender balance not reduced correctly");
        assert_eq!(bob_after - bob_before, 400, "INVARIANT VIOLATION: Receiver balance not increased correctly");
    }

    #[test]
    fn invariant_allowance_decrease_on_transfer_from() {
        let (env, client, sac, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &owner, 1000);
        client.approve(&owner, &spender, &500);
        let allowance_before = client.allowance(&owner, &spender);
        client.transfer_from(&spender, &owner, &recipient, &200);
        let allowance_after = client.allowance(&owner, &spender);
        assert_eq!(allowance_before - allowance_after, 200, "INVARIANT VIOLATION: Allowance not reduced correctly");
    }

    #[test]
    #[should_panic]
    fn invariant_allowance_cannot_exceed_approval() {
        let (env, client, sac, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &owner, 1000);
        client.approve(&owner, &spender, &100);
        client.transfer_from(&spender, &owner, &recipient, &150);
    }

    #[test]
    fn invariant_decrease_allowance_reduces_correctly() {
        let (env, client, sac, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &owner, 1000);
        client.approve(&owner, &spender, &500);
        let before = client.allowance(&owner, &spender);
        client.decrease_allowance(&owner, &spender, &200);
        let after = client.allowance(&owner, &spender);
        assert_eq!(before - after, 200, "INVARIANT VIOLATION: decrease_allowance did not reduce allowance by the correct amount");
    }

    #[test]
    fn invariant_decrease_allowance_to_zero_resets_cleanly() {
        let (env, client, sac, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &owner, 1000);
        client.approve(&owner, &spender, &300);
        client.decrease_allowance(&owner, &spender, &300);
        assert_eq!(client.allowance(&owner, &spender), 0, "INVARIANT VIOLATION: Allowance not zero after full decrease");
    }

    #[test]
    fn invariant_decrease_allowance_preserves_supply() {
        let (env, client, sac, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &owner, 1000);
        client.approve(&owner, &spender, &500);
        let supply_before = client.total_supply();
        client.decrease_allowance(&owner, &spender, &100);
        assert_eq!(client.total_supply(), supply_before, "INVARIANT VIOLATION: decrease_allowance changed total supply");
    }

    #[test]
    fn invariant_decrease_allowance_does_not_affect_balances() {
        let (env, client, sac, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &owner, 1000);
        client.approve(&owner, &spender, &500);
        let owner_bal_before = client.balance_of(&owner);
        let spender_bal_before = client.balance_of(&spender);
        client.decrease_allowance(&owner, &spender, &100);
        assert_eq!(client.balance_of(&owner), owner_bal_before, "INVARIANT VIOLATION: decrease_allowance changed owner balance");
        assert_eq!(client.balance_of(&spender), spender_bal_before, "INVARIANT VIOLATION: decrease_allowance changed spender balance");
    }

    #[test]
    fn invariant_increase_allowance_preserves_invariants() {
        let (env, client, sac, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let users = [owner.clone(), spender.clone()];
        fund_and_deposit(&env, &sac, &client, &owner, 1000);
        client.approve(&owner, &spender, &500);
        let supply_before = client.total_supply();
        let owner_bal_before = client.balance_of(&owner);
        let spender_bal_before = client.balance_of(&spender);
        client.increase_allowance(&owner, &spender, &200);
        assert_eq!(client.total_supply(), supply_before);
        assert_eq!(client.balance_of(&owner), owner_bal_before);
        assert_eq!(client.balance_of(&spender), spender_bal_before);
        verify_supply_conservation(&env, &client, &users);
    }

    #[test]
    fn invariant_allowance_decrease_and_transfer_from_sequence() {
        let (env, client, sac, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let users = [owner.clone(), spender.clone(), recipient.clone()];
        fund_and_deposit(&env, &sac, &client, &owner, 1000);
        client.approve(&owner, &spender, &500);
        client.decrease_allowance(&owner, &spender, &200);
        assert_eq!(client.allowance(&owner, &spender), 300);
        client.transfer_from(&spender, &owner, &recipient, &300);
        assert_eq!(client.allowance(&owner, &spender), 0);
        assert_eq!(client.balance_of(&recipient), 300);
        verify_supply_conservation(&env, &client, &users);
    }

    #[test]
    #[should_panic]
    fn invariant_no_double_spend_direct() {
        let (env, client, sac, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &alice, 100);
        client.transfer(&alice, &bob, &60);
        client.transfer(&alice, &carol, &60);
    }

    #[test]
    fn invariant_supply_only_changes_via_deposit_withdraw_burn() {
        let (env, client, sac, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let initial_supply = client.total_supply();
        assert_eq!(initial_supply, 0);
        fund_and_deposit(&env, &sac, &client, &alice, 500);
        assert_eq!(client.total_supply(), 500);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);
        client.transfer(&alice, &bob, &200);
        assert_eq!(client.total_supply(), 500, "INVARIANT VIOLATION: Transfer changed total supply");
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);
        client.approve(&alice, &bob, &100);
        assert_eq!(client.total_supply(), 500, "INVARIANT VIOLATION: Approve changed total supply");
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);
        client.burn(&alice, &100);
        assert_eq!(client.total_supply(), 400);
        verify_supply_conservation(&env, &client, &[alice, bob]);
    }

    #[test]
    #[should_panic]
    fn invariant_deposit_zero_rejected() {
        let (env, client, sac, _) = setup_fresh();
        let user = Address::generate(&env);
        client.deposit(&user, &0);
    }

    #[test]
    #[should_panic]
    fn invariant_withdraw_zero_rejected() {
        let (env, client, sac, _) = setup_fresh();
        let user = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &user, 100);
        client.withdraw(&user, &0);
    }

    #[test]
    #[should_panic]
    fn invariant_burn_zero_rejected() {
        let (env, client, sac, _) = setup_fresh();
        let user = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &user, 100);
        client.burn(&user, &0);
    }

    #[test]
    fn invariant_approve_overwrites() {
        let (env, client, sac, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &owner, 1000);
        client.approve(&owner, &spender, &100);
        assert_eq!(client.allowance(&owner, &spender), 100);
        client.approve(&owner, &spender, &200);
        assert_eq!(client.allowance(&owner, &spender), 200, "INVARIANT VIOLATION: Approve did not overwrite previous allowance");
    }

    #[test]
    fn property_sequence_invariant() {
        let (env, client, sac, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &alice, 1000);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);
        fund_and_deposit(&env, &sac, &client, &bob, 500);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);
        client.transfer(&alice, &bob, &200);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);
        client.approve(&bob, &carol, &300);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);
        client.transfer_from(&carol, &bob, &alice, &150);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);
        client.withdraw(&alice, &100);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone(), carol.clone()]);

        // Verify final invariants
        let total_balance = client.balance_of(&alice) + client.balance_of(&bob) + client.balance_of(&carol);
        assert_eq!(client.total_supply(), total_balance, "PROPERTY VIOLATION: Supply invariant broken after operation sequence");
        assert!(client.balance_of(&alice) >= 0 && client.balance_of(&bob) >= 0 && client.balance_of(&carol) >= 0, "PROPERTY VIOLATION: Negative balance detected");
    }

    #[test]
    fn property_deposit_withdraw_symmetry() {
        let (env, client, sac, _) = setup_fresh();
        let user = Address::generate(&env);
        let initial_supply = client.total_supply();
        let initial_balance = client.balance_of(&user);
        fund_and_deposit(&env, &sac, &client, &user, 500);
        verify_supply_conservation(&env, &client, &[user.clone()]);
        client.withdraw(&user, &500);
        verify_supply_conservation(&env, &client, &[user.clone()]);
        assert_eq!(client.total_supply(), initial_supply, "PROPERTY VIOLATION: Deposit-withdraw symmetry broken for supply");
        assert_eq!(client.balance_of(&user), initial_balance, "PROPERTY VIOLATION: Deposit-withdraw symmetry broken for balance");
    }

    #[test]
    fn property_transfer_reversibility_check() {
        let (env, client, sac, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        fund_and_deposit(&env, &sac, &client, &alice, 1000);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);
        let alice_initial = client.balance_of(&alice);
        let bob_initial = client.balance_of(&bob);
        client.transfer(&alice, &bob, &300);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);
        client.transfer(&bob, &alice, &300);
        verify_supply_conservation(&env, &client, &[alice.clone(), bob.clone()]);
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
        let (env, client, sac, _) = setup_fresh();
        let mut users = std::vec::Vec::new();
        let mut total_deposited = 0_i128;
        for i in 0..10 {
            let user = Address::generate(&env);
            let amount = ((i + 1) * 100) as i128;
            fund_and_deposit(&env, &sac, &client, &user, amount);
            total_deposited += amount;
            users.push(user);
            verify_supply_conservation(&env, &client, &users);
        }
        let total_deposited = 1000;
        assert_eq!(client.total_supply(), total_deposited, "PROPERTY VIOLATION: Total supply doesn't match total deposited");
        for i in 0..5 {
            let from = &users[i];
            let to = &users[i + 1];
            client.transfer(from, to, &50);
            verify_supply_conservation(&env, &client, &users);
        }
        assert_eq!(client.total_supply(), total_deposited, "PROPERTY VIOLATION: Supply changed during transfers");
    }
}
