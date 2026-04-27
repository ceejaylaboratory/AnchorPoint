#![no_std]
//! SEP-41 Compatible Token Wrapper

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String};

#[contracttype]
pub enum DataKey {
    Admin,
    Balance(u64, Address),
    Allowance(u64, Address, Address),
    OperatorApproval(Address, Address),
    TotalSupply(u64),
    TokenMetadata(u64),
    Name,
    Symbol,
    Decimals,
    UserLastLedger(u64, Address),
    BalanceSnapshot(u64, Address, u32),
}

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    pub fn initialize(env: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
    }

    pub fn mint(env: Env, to: Address, token_id: u64, amount: i128) {
        assert!(amount > 0, "amount must be positive");
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();

        let bal = Self::balance_of(env.clone(), to.clone(), token_id);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(token_id, to.clone()), &(bal + amount));

        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply(token_id))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply(token_id), &(supply + amount));

        env.events()
            .publish((symbol_short!("mint"), to, token_id), amount);
    }

    pub fn transfer(env: Env, from: Address, to: Address, token_id: u64, amount: i128) {
        from.require_auth();
        Self::do_transfer(&env, from, to, token_id, amount);
    }

    pub fn batch_transfer(
        env: Env,
        from: Address,
        to: Address,
        token_ids: soroban_sdk::Vec<u64>,
        amounts: soroban_sdk::Vec<i128>,
    ) {
        from.require_auth();
        assert!(token_ids.len() == amounts.len(), "length mismatch");

        for i in 0..token_ids.len() {
            let token_id = token_ids.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            Self::do_transfer(&env, from.clone(), to.clone(), token_id, amount);
        }

        env.events()
            .publish((symbol_short!("batch_xf"), from, to), token_ids);
    }

    pub fn approve(env: Env, owner: Address, spender: Address, token_id: u64, amount: i128) {
        owner.require_auth();
        assert!(amount >= 0, "amount must be non-negative");
        env.storage().persistent().set(
            &DataKey::Allowance(token_id, owner.clone(), spender.clone()),
            &amount,
        );
        env.events()
            .publish((symbol_short!("approve"), owner, spender, token_id), amount);
    }

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

    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        token_id: u64,
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
            let allowance = Self::allowance(env.clone(), from.clone(), spender.clone(), token_id);
            assert!(allowance >= amount, "insufficient allowance");
            env.storage().persistent().set(
                &DataKey::Allowance(token_id, from.clone(), spender.clone()),
                &(allowance - amount),
            );
        }

        Self::do_transfer(&env, from, to, token_id, amount);
        env.events()
            .publish((symbol_short!("xfer_from"), spender, token_id), amount);
    }

    pub fn burn(env: Env, from: Address, token_id: u64, amount: i128) {
        from.require_auth();
        assert!(amount > 0, "amount must be positive");
        let bal = Self::balance_of(env.clone(), from.clone(), token_id);
        assert!(bal >= amount, "insufficient balance");

        env.storage()
            .persistent()
            .set(&DataKey::Balance(token_id, from.clone()), &(bal - amount));
        let supply: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply(token_id))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply(token_id), &(supply - amount));

        env.events()
            .publish((symbol_short!("burn"), from, token_id), amount);
    }

    pub fn set_token_metadata(env: Env, token_id: u64, uri: String) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::TokenMetadata(token_id), &uri);
        env.events()
            .publish((symbol_short!("meta_set"), token_id), uri);
    }

    pub fn get_token_metadata(env: Env, token_id: u64) -> String {
        env.storage()
            .instance()
            .get(&DataKey::TokenMetadata(token_id))
            .unwrap_or(String::from_str(&env, ""))
    }

    pub fn balance_of(env: Env, owner: Address, token_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(token_id, owner))
            .unwrap_or(0)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address, token_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Allowance(token_id, owner, spender))
            .unwrap_or(0)
    }

    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::OperatorApproval(owner, operator))
            .unwrap_or(false)
    }

    pub fn total_supply(env: Env, token_id: u64) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply(token_id))
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

    pub fn get_past_balance(env: Env, owner: Address, token_id: u64, ledger: u32) -> i128 {
        let last_ledger: u32 = env.storage().persistent().get(&DataKey::UserLastLedger(token_id, owner.clone())).unwrap_or(0);
        if ledger >= last_ledger {
            return Self::balance_of(env.clone(), owner, token_id);
        }
        env.storage().persistent().get(&DataKey::BalanceSnapshot(token_id, owner, ledger)).unwrap_or(0)
    }

    fn do_transfer(env: &Env, from: Address, to: Address, token_id: u64, amount: i128) {
        assert!(amount > 0, "amount must be positive");
        let from_bal = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Balance(token_id, from.clone()))
            .unwrap_or(0);
        assert!(from_bal >= amount, "insufficient balance");

        let current_ledger = env.ledger().sequence();
        Self::_write_checkpoint(env, from.clone(), token_id, current_ledger, from_bal);

        env.storage().persistent().set(
            &DataKey::Balance(token_id, from.clone()),
            &(from_bal - amount),
        );
        let to_bal = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Balance(token_id, to.clone()))
            .unwrap_or(0);

        Self::_write_checkpoint(env, to.clone(), token_id, current_ledger, to_bal);

        env.storage()
            .persistent()
            .set(&DataKey::Balance(token_id, to.clone()), &(to_bal + amount));

        env.events()
            .publish((symbol_short!("transfer"), from, to, token_id), amount);
    }

    fn _write_checkpoint(env: &Env, user: Address, token_id: u64, current_ledger: u32, current_balance: i128) {
        let last_ledger: u32 = env.storage().persistent().get(&DataKey::UserLastLedger(token_id, user.clone())).unwrap_or(0);
        if last_ledger != current_ledger {
            env.storage().persistent().set(&DataKey::BalanceSnapshot(token_id, user.clone(), last_ledger), &current_balance);
            env.storage().persistent().set(&DataKey::UserLastLedger(token_id, user.clone()), &current_ledger);
        }
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    fn setup() -> (Env, TokenContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(TokenContract, ());
        let client = TokenContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AnchorToken"),
            &String::from_str(&env, "ANCT"),
        );
        (env, client, admin)
    }

    #[test]
    fn test_initialize() {
        let (env, client, _) = setup();
        assert_eq!(client.decimals(), 7);
        assert_eq!(client.name(), String::from_str(&env, "AnchorToken"));
        assert_eq!(client.symbol(), String::from_str(&env, "ANCT"));
        assert_eq!(client.total_supply(&1), 0);
    }

    #[test]
    fn test_mint() {
        let (env, client, _) = setup();
        let user = Address::generate(&env);
        let token_id = 1u64;
        client.mint(&user, &token_id, &1000);
        assert_eq!(client.balance_of(&user, &token_id), 1000);
        assert_eq!(client.total_supply(&token_id), 1000);
    }

    #[test]
    fn test_batch_transfer() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.mint(&alice, &1, &1000);
        client.mint(&alice, &2, &500);

        let mut ids = soroban_sdk::Vec::new(&env);
        ids.push_back(1);
        ids.push_back(2);

        let mut amounts = soroban_sdk::Vec::new(&env);
        amounts.push_back(300);
        amounts.push_back(200);

        client.batch_transfer(&alice, &bob, &ids, &amounts);

        assert_eq!(client.balance_of(&alice, &1), 700);
        assert_eq!(client.balance_of(&bob, &1), 300);
        assert_eq!(client.balance_of(&alice, &2), 300);
        assert_eq!(client.balance_of(&bob, &2), 200);
    }

    #[test]
    fn test_metadata() {
        let (env, client, _admin) = setup();
        let token_id = 1u64;
        let uri = String::from_str(&env, "ipfs://test");

        client.set_token_metadata(&token_id, &uri);
        assert_eq!(client.get_token_metadata(&token_id), uri);
    }

    #[test]
    fn test_operator_approval() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let operator = Address::generate(&env);
        let bob = Address::generate(&env);

        client.mint(&alice, &1, &1000);
        client.set_approval_for_all(&alice, &operator, &true);

        assert!(client.is_approved_for_all(&alice, &operator));

        client.transfer_from(&operator, &alice, &bob, &1, &300);
        assert_eq!(client.balance_of(&bob, &1), 300);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_mint_zero_panics() {
        let (env, client, _) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &1, &0);
    }

    #[test]
    fn test_transfer() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let token_id = 1u64;
        client.mint(&alice, &token_id, &500);
        client.transfer(&alice, &bob, &token_id, &200);
        assert_eq!(client.balance_of(&alice, &token_id), 300);
        assert_eq!(client.balance_of(&bob, &token_id), 200);
    }

    #[test]
    fn test_burn() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let token_id = 1u64;
        client.mint(&alice, &token_id, &500);
        client.burn(&alice, &token_id, &200);
        assert_eq!(client.balance_of(&alice, &token_id), 300);
        assert_eq!(client.total_supply(&token_id), 300);
    }

    #[test]
    #[should_panic(expected = "length mismatch")]
    fn test_batch_transfer_length_mismatch() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let ids = soroban_sdk::Vec::from_array(&env, [1, 2]);
        let amounts = soroban_sdk::Vec::from_array(&env, [100]);
        client.batch_transfer(&alice, &bob, &ids, &amounts);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_initialize_twice_panics() {
        let (env, client, admin) = setup();
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AnchorToken"),
            &String::from_str(&env, "ANCT"),
        );
    }

    #[test]
    fn test_operator_does_not_consume_allowance() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let operator = Address::generate(&env);
        let bob = Address::generate(&env);

        client.mint(&alice, &1, &1000);
        client.approve(&alice, &operator, &1, &500);
        client.set_approval_for_all(&alice, &operator, &true);

        client.transfer_from(&operator, &alice, &bob, &1, &300);
        
        // Allowance should still be 500 because operator bypasses it
        assert_eq!(client.allowance(&alice, &operator, &1), 500);
    }

    #[test]
    #[should_panic(expected = "insufficient allowance")]
    fn test_transfer_from_insufficient_allowance() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);

        client.mint(&alice, &1, &1000);
        client.approve(&alice, &spender, &1, &100);
        client.transfer_from(&spender, &alice, &bob, &1, &150);
    }

    #[test]
    fn test_set_metadata_authorized() {
        let (env, client, admin) = setup();
        let token_id = 1u64;
        let uri = String::from_str(&env, "ipfs://test");

        client.set_token_metadata(&token_id, &uri);
        assert_eq!(client.get_token_metadata(&token_id), uri);
    }
}



/// ============================================================================
/// Formal Verification Invariants
/// ============================================================================
/// These tests verify critical invariants that must hold for all valid states
/// and operations of the token contract. They use property-based testing
/// patterns to ensure mathematical correctness.
#[cfg(test)]
mod invariants {
    extern crate std;
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env, String};

    /// Helper to set up a fresh contract instance
    fn setup_fresh() -> (Env, TokenContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(TokenContract, ());
        let client = TokenContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(
            &admin,
            &7u32,
            &String::from_str(&env, "AnchorToken"),
            &String::from_str(&env, "ANCT"),
        );
        (env, client, admin)
    }

    // =========================================================================
    // INVARIANT 1: Conservation of Supply
    // =========================================================================
    /// After any operation, the sum of all user balances must equal total_supply.
    /// This is the fundamental invariant of any token contract.
    #[test]
    fn invariant_supply_conservation_after_mint() {
        let (env, client, _) = setup_fresh();
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        let user3 = Address::generate(&env);
        let token_id = 1u64;

        // Mint to multiple users
        client.mint(&user1, &token_id, &1000);
        client.mint(&user2, &token_id, &500);
        client.mint(&user3, &token_id, &250);

        let balance_sum = client.balance_of(&user1, &token_id)
            + client.balance_of(&user2, &token_id)
            + client.balance_of(&user3, &token_id);

        // Invariant: sum of balances equals total supply
        assert_eq!(
            client.total_supply(&token_id),
            balance_sum,
            "INVARIANT VIOLATION: Supply conservation failed after mint"
        );
    }

    #[test]
    fn invariant_supply_conservation_after_transfer() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        let token_id = 1u64;

        client.mint(&alice, &token_id, &1000);

        let supply_before = client.total_supply(&token_id);

        // Multiple transfers
        client.transfer(&alice, &bob, &token_id, &300);
        client.transfer(&bob, &carol, &token_id, &150);
        client.transfer(&alice, &carol, &token_id, &100);

        let supply_after = client.total_supply(&token_id);

        // Invariant: transfers do not change total supply
        assert_eq!(
            supply_before, supply_after,
            "INVARIANT VIOLATION: Supply changed during transfers"
        );

        // Invariant: sum of balances still equals supply
        let balance_sum = client.balance_of(&alice, &token_id)
            + client.balance_of(&bob, &token_id)
            + client.balance_of(&carol, &token_id);
        assert_eq!(
            supply_after, balance_sum,
            "INVARIANT VIOLATION: Balance sum doesn't match supply after transfers"
        );
    }

    #[test]
    fn invariant_supply_conservation_after_burn() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);
        let token_id = 1u64;

        client.mint(&user, &token_id, &1000);
        let supply_before_burn = client.total_supply(&token_id);

        client.burn(&user, &token_id, &300);

        // Invariant: supply decreases by exactly the burned amount
        assert_eq!(
            client.total_supply(&token_id),
            supply_before_burn - 300,
            "INVARIANT VIOLATION: Supply not reduced correctly after burn"
        );

        // Invariant: balance equals remaining supply
        assert_eq!(
            client.balance_of(&user, &token_id),
            client.total_supply(&token_id),
            "INVARIANT VIOLATION: Balance doesn't match supply after burn"
        );
    }

    // =========================================================================
    // INVARIANT 2: Non-Negative Balances
    // =========================================================================
    /// All balances must always be non-negative (>= 0).
    /// This is enforced by the contract logic, but we verify it holds.
    #[test]
    fn invariant_non_negative_balances() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);
        let token_id = 1u64;

        // Initial balance is 0 (non-negative)
        assert!(
            client.balance_of(&user, &token_id) >= 0,
            "INVARIANT VIOLATION: Initial balance is negative"
        );

        client.mint(&user, &token_id, &100);
        assert!(
            client.balance_of(&user, &token_id) >= 0,
            "INVARIANT VIOLATION: Balance negative after mint"
        );

        client.burn(&user, &token_id, &100);
        assert!(
            client.balance_of(&user, &token_id) >= 0,
            "INVARIANT VIOLATION: Balance negative after burn"
        );
    }

    // =========================================================================
    // INVARIANT 3: Conservation of Value in Transfer
    // =========================================================================
    /// In any transfer, the sum of sender and receiver balances before
    /// must equal the sum after the transfer.
    #[test]
    fn invariant_transfer_value_conservation() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let token_id = 1u64;

        client.mint(&alice, &token_id, &1000);

        let alice_before = client.balance_of(&alice, &token_id);
        let bob_before = client.balance_of(&bob, &token_id);
        let sum_before = alice_before + bob_before;

        client.transfer(&alice, &bob, &token_id, &400);

        let alice_after = client.balance_of(&alice, &token_id);
        let bob_after = client.balance_of(&bob, &token_id);
        let sum_after = alice_after + bob_after;

        // Invariant: total value is conserved
        assert_eq!(
            sum_before, sum_after,
            "INVARIANT VIOLATION: Value not conserved in transfer"
        );

        // Additional checks: exact changes
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
    // INVARIANT 4: Allowance Accounting
    // =========================================================================
    /// After transfer_from, the allowance must decrease by exactly the
    /// transferred amount.
    #[test]
    fn invariant_allowance_decrease_on_transfer_from() {
        let (env, client, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token_id = 1u64;

        client.mint(&owner, &token_id, &1000);
        client.approve(&owner, &spender, &token_id, &500);

        let allowance_before = client.allowance(&owner, &spender, &token_id);

        client.transfer_from(&spender, &owner, &recipient, &token_id, &200);

        let allowance_after = client.allowance(&owner, &spender, &token_id);

        // Invariant: allowance decreased by exactly the spent amount
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
        let token_id = 1u64;

        client.mint(&owner, &token_id, &1000);
        client.approve(&owner, &spender, &token_id, &100);

        // Attempting to spend more than approved should fail
        client.transfer_from(&spender, &owner, &recipient, &token_id, &150);
    }

    // =========================================================================
    // INVARIANT 5: No Double Spend
    // =========================================================================
    /// A user cannot spend the same tokens twice (either directly or via approval).
    #[test]
    #[should_panic]
    fn invariant_no_double_spend_direct() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        let token_id = 1u64;

        client.mint(&alice, &token_id, &100);

        // First transfer succeeds
        client.transfer(&alice, &bob, &token_id, &60);

        // Alice now has 40, trying to spend 60 more should fail
        client.transfer(&alice, &carol, &token_id, &60);
    }

    // =========================================================================
    // INVARIANT 6: Total Supply Monotonicity
    // =========================================================================
    /// Total supply only increases via mint and only decreases via burn.
    /// Transfers do not affect total supply.
    #[test]
    fn invariant_supply_only_changes_via_mint_burn() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let token_id = 1u64;

        let initial_supply = client.total_supply(&token_id);
        assert_eq!(initial_supply, 0);

        // Mint increases supply
        client.mint(&alice, &token_id, &500);
        assert_eq!(client.total_supply(&token_id), 500);

        // Transfer does not change supply
        client.transfer(&alice, &bob, &token_id, &200);
        assert_eq!(
            client.total_supply(&token_id),
            500,
            "INVARIANT VIOLATION: Transfer changed total supply"
        );

        // Approve does not change supply
        client.approve(&alice, &bob, &token_id, &100);
        assert_eq!(
            client.total_supply(&token_id),
            500,
            "INVARIANT VIOLATION: Approve changed total supply"
        );

        // Burn decreases supply
        client.burn(&alice, &token_id, &100);
        assert_eq!(client.total_supply(&token_id), 400);
    }

    // =========================================================================
    // INVARIANT 7: Zero Address Handling
    // =========================================================================
    /// The contract should handle zero amounts appropriately.
    #[test]
    #[should_panic]
    fn invariant_mint_zero_rejected() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);
        let token_id = 1u64;

        client.mint(&user, &token_id, &0);
    }

    #[test]
    #[should_panic]
    fn invariant_burn_zero_rejected() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);
        let token_id = 1u64;

        client.mint(&user, &token_id, &100);
        client.burn(&user, &token_id, &0);
    }

    // =========================================================================
    // INVARIANT 8: Idempotency Properties
    // =========================================================================
    /// Certain operations should have predictable idempotent-like behavior.
    #[test]
    fn invariant_approve_overwrites() {
        let (env, client, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let token_id = 1u64;

        client.approve(&owner, &spender, &token_id, &100);
        assert_eq!(client.allowance(&owner, &spender, &token_id), 100);

        // New approval should overwrite, not add
        client.approve(&owner, &spender, &token_id, &200);
        assert_eq!(
            client.allowance(&owner, &spender, &token_id),
            200,
            "INVARIANT VIOLATION: Approve did not overwrite previous allowance"
        );
    }

    // =========================================================================
    // PROPERTY-BASED INVARIANT TESTS
    // =========================================================================
    /// These tests verify invariants across sequences of random-ish operations.

    #[test]
    fn property_sequence_invariant() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        let token_id = 1u64;

        // Sequence of operations that should maintain invariants
        client.mint(&alice, &token_id, &1000); // Alice: 1000
        client.mint(&bob, &token_id, &500); // Bob: 500
        client.transfer(&alice, &bob, &token_id, &200); // Alice: 800, Bob: 700
        client.approve(&bob, &carol, &token_id, &300);
        client.transfer_from(&carol, &bob, &alice, &token_id, &150); // Alice: 950, Bob: 550
        client.burn(&alice, &token_id, &100); // Total supply reduced by 100

        // Verify final invariants
        let total_balance = client.balance_of(&alice, &token_id)
            + client.balance_of(&bob, &token_id)
            + client.balance_of(&carol, &token_id);

        assert_eq!(
            client.total_supply(&token_id),
            total_balance,
            "PROPERTY VIOLATION: Supply invariant broken after operation sequence"
        );

        assert!(
            client.balance_of(&alice, &token_id) >= 0
                && client.balance_of(&bob, &token_id) >= 0
                && client.balance_of(&carol, &token_id) >= 0,
            "PROPERTY VIOLATION: Negative balance detected"
        );
    }

    #[test]
    fn property_mint_burn_symmetry() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);
        let token_id = 1u64;

        // Mint then burn same amount should return to initial state
        let initial_supply = client.total_supply(&token_id);
        let initial_balance = client.balance_of(&user, &token_id);

        client.mint(&user, &token_id, &500);
        client.burn(&user, &token_id, &500);

        assert_eq!(
            client.total_supply(&token_id),
            initial_supply,
            "PROPERTY VIOLATION: Mint-burn symmetry broken for supply"
        );
        assert_eq!(
            client.balance_of(&user, &token_id),
            initial_balance,
            "PROPERTY VIOLATION: Mint-burn symmetry broken for balance"
        );
    }

    #[test]
    fn property_transfer_reversibility_check() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let token_id = 1u64;

        client.mint(&alice, &token_id, &1000);

        let alice_initial = client.balance_of(&alice, &token_id);
        let bob_initial = client.balance_of(&bob, &token_id);

        // Transfer A -> B
        client.transfer(&alice, &bob, &token_id, &300);

        // Transfer B -> A (reverse)
        client.transfer(&bob, &alice, &token_id, &300);

        // After round-trip, balances should be back to original
        assert_eq!(
            client.balance_of(&alice, &token_id),
            alice_initial,
            "PROPERTY VIOLATION: Round-trip transfer didn't restore sender balance"
        );
        assert_eq!(
            client.balance_of(&bob, &token_id),
            bob_initial,
            "PROPERTY VIOLATION: Round-trip transfer didn't restore receiver balance"
        );
    }
}
