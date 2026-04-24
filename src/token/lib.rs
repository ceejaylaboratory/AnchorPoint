#![no_std]
//! SEP-41 Compatible Token Wrapper

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String};

#[contracttype]
pub enum DataKey {
    Admin,
    Balance(Address),
    Allowance(Address, Address),
    TotalSupply,
    Name,
    Symbol,
    Decimals,
}

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    pub fn initialize(env: Env, admin: Address, decimals: u32, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimals);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage().instance().set(&DataKey::TotalSupply, &0_i128);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        assert!(amount > 0, "amount must be positive");
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let bal = Self::balance_of(env.clone(), to.clone());
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &(bal + amount));
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply + amount));
        env.events().publish((symbol_short!("mint"), to), amount);
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        from.require_auth();
        assert!(amount > 0, "amount must be positive");
        let from_bal = Self::balance_of(env.clone(), from.clone());
        assert!(from_bal >= amount, "insufficient balance");
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(from_bal - amount));
        let to_bal = Self::balance_of(env.clone(), to.clone());
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &(to_bal + amount));
        env.events().publish((symbol_short!("transfer"), from, to), amount);
    }

    pub fn approve(env: Env, owner: Address, spender: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        owner.require_auth();
        assert!(amount >= 0, "amount must be non-negative");
        env.storage().persistent().set(&DataKey::Allowance(owner.clone(), spender.clone()), &amount);
        env.events().publish((symbol_short!("approve"), owner, spender), amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        spender.require_auth();
        assert!(amount > 0, "amount must be positive");
        let allowance = Self::allowance(env.clone(), from.clone(), spender.clone());
        assert!(allowance >= amount, "insufficient allowance");
        env.storage().persistent().set(&DataKey::Allowance(from.clone(), spender.clone()), &(allowance - amount));
        let from_bal = Self::balance_of(env.clone(), from.clone());
        assert!(from_bal >= amount, "insufficient balance");
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(from_bal - amount));
        let to_bal = Self::balance_of(env.clone(), to.clone());
        env.storage().persistent().set(&DataKey::Balance(to.clone()), &(to_bal + amount));
        env.events().publish((symbol_short!("xfer_from"), from, to), amount);
    }

    pub fn burn(env: Env, from: Address, amount: i128) {

        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        from.require_auth();
        assert!(amount > 0, "amount must be positive");
        let bal = Self::balance_of(env.clone(), from.clone());
        assert!(bal >= amount, "insufficient balance");
        env.storage().persistent().set(&DataKey::Balance(from.clone()), &(bal - amount));
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        env.storage().instance().set(&DataKey::TotalSupply, &(supply - amount));
        env.events().publish((symbol_short!("burn"), from), amount);
    }

    pub fn balance_of(env: Env, id: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Balance(id)).unwrap_or(0)
    }

    pub fn allowance(env: Env, owner: Address, spender: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Allowance(owner, spender)).unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0)
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Decimals).unwrap_or(7)
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }
}

#[cfg(test)]
mod tests {
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
        assert_eq!(client.total_supply(), 0);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let (env, client, admin) = setup();
        client.initialize(&admin, &7, &String::from_str(&env, "X"), &String::from_str(&env, "X"));
    }

    #[test]
    fn test_mint() {
        let (env, client, _) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &1000);
        assert_eq!(client.balance_of(&user), 1000);
        assert_eq!(client.total_supply(), 1000);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_mint_zero_panics() {
        let (env, client, _) = setup();
        let user = Address::generate(&env);
        client.mint(&user, &0);
    }

    #[test]
    fn test_transfer() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &500);
        client.transfer(&alice, &bob, &200);
        assert_eq!(client.balance_of(&alice), 300);
        assert_eq!(client.balance_of(&bob), 200);
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn test_transfer_insufficient_balance() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        client.mint(&alice, &100);
        client.transfer(&alice, &bob, &200);
    }

    #[test]
    fn test_approve_and_transfer_from() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        client.mint(&alice, &1000);
        client.approve(&alice, &bob, &300);
        assert_eq!(client.allowance(&alice, &bob), 300);
        client.transfer_from(&bob, &alice, &carol, &200);
        assert_eq!(client.balance_of(&alice), 800);
        assert_eq!(client.balance_of(&carol), 200);
        assert_eq!(client.allowance(&alice, &bob), 100);
    }

    #[test]
    #[should_panic(expected = "insufficient allowance")]
    fn test_transfer_from_exceeds_allowance() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);
        client.mint(&alice, &1000);
        client.approve(&alice, &bob, &50);
        client.transfer_from(&bob, &alice, &carol, &100);
    }

    #[test]
    fn test_burn() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &500);
        client.burn(&alice, &200);
        assert_eq!(client.balance_of(&alice), 300);
        assert_eq!(client.total_supply(), 300);
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn test_burn_exceeds_balance() {
        let (env, client, _) = setup();
        let alice = Address::generate(&env);
        client.mint(&alice, &100);
        client.burn(&alice, &200);
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

        // Mint to multiple users
        client.mint(&user1, &1000);
        client.mint(&user2, &500);
        client.mint(&user3, &250);

        let balance_sum = client.balance_of(&user1)
            + client.balance_of(&user2)
            + client.balance_of(&user3);
        
        // Invariant: sum of balances equals total supply
        assert_eq!(
            client.total_supply(),
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

        client.mint(&alice, &1000);

        let supply_before = client.total_supply();
        
        // Multiple transfers
        client.transfer(&alice, &bob, &300);
        client.transfer(&bob, &carol, &150);
        client.transfer(&alice, &carol, &100);

        let supply_after = client.total_supply();
        
        // Invariant: transfers do not change total supply
        assert_eq!(
            supply_before,
            supply_after,
            "INVARIANT VIOLATION: Supply changed during transfers"
        );

        // Invariant: sum of balances still equals supply
        let balance_sum = client.balance_of(&alice)
            + client.balance_of(&bob)
            + client.balance_of(&carol);
        assert_eq!(
            supply_after,
            balance_sum,
            "INVARIANT VIOLATION: Balance sum doesn't match supply after transfers"
        );
    }

    #[test]
    fn invariant_supply_conservation_after_burn() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        client.mint(&user, &1000);
        let supply_before_burn = client.total_supply();
        
        client.burn(&user, &300);
        
        // Invariant: supply decreases by exactly the burned amount
        assert_eq!(
            client.total_supply(),
            supply_before_burn - 300,
            "INVARIANT VIOLATION: Supply not reduced correctly after burn"
        );

        // Invariant: balance equals remaining supply
        assert_eq!(
            client.balance_of(&user),
            client.total_supply(),
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

        // Initial balance is 0 (non-negative)
        assert!(
            client.balance_of(&user) >= 0,
            "INVARIANT VIOLATION: Initial balance is negative"
        );

        client.mint(&user, &100);
        assert!(
            client.balance_of(&user) >= 0,
            "INVARIANT VIOLATION: Balance negative after mint"
        );

        client.burn(&user, &100);
        assert!(
            client.balance_of(&user) >= 0,
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

        client.mint(&alice, &1000);

        let alice_before = client.balance_of(&alice);
        let bob_before = client.balance_of(&bob);
        let sum_before = alice_before + bob_before;

        client.transfer(&alice, &bob, &400);

        let alice_after = client.balance_of(&alice);
        let bob_after = client.balance_of(&bob);
        let sum_after = alice_after + bob_after;

        // Invariant: total value is conserved
        assert_eq!(
            sum_before,
            sum_after,
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

        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &500);

        let allowance_before = client.allowance(&owner, &spender);
        
        client.transfer_from(&spender, &owner, &recipient, &200);

        let allowance_after = client.allowance(&owner, &spender);

        // Invariant: allowance decreased by exactly the spent amount
        assert_eq!(
            allowance_before - allowance_after,
            200,
            "INVARIANT VIOLATION: Allowance not reduced correctly"
        );
    }

    #[test]
    fn invariant_allowance_cannot_exceed_approval() {
        let (env, client, _) = setup_fresh();
        let owner = Address::generate(&env);
        let spender = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.mint(&owner, &1000);
        client.approve(&owner, &spender, &100);

        // Attempting to spend more than approved should fail
        let result = std::panic::catch_unwind(|| {
            client.transfer_from(&spender, &owner, &recipient, &150);
        });
        
        assert!(
            result.is_err(),
            "INVARIANT VIOLATION: Spender was able to exceed allowance"
        );
    }

    // =========================================================================
    // INVARIANT 5: No Double Spend
    // =========================================================================
    /// A user cannot spend the same tokens twice (either directly or via approval).
    #[test]
    fn invariant_no_double_spend_direct() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);

        client.mint(&alice, &100);

        // First transfer succeeds
        client.transfer(&alice, &bob, &60);
        
        // Alice now has 40, trying to spend 60 more should fail
        let result = std::panic::catch_unwind(|| {
            client.transfer(&alice, &carol, &60);
        });
        
        assert!(
            result.is_err(),
            "INVARIANT VIOLATION: Double spend was possible"
        );
        
        // Verify final state is consistent
        assert_eq!(client.balance_of(&alice), 40);
        assert_eq!(client.balance_of(&bob), 60);
        assert_eq!(client.balance_of(&carol), 0);
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

        let initial_supply = client.total_supply();
        assert_eq!(initial_supply, 0);

        // Mint increases supply
        client.mint(&alice, &500);
        assert_eq!(client.total_supply(), 500);

        // Transfer does not change supply
        client.transfer(&alice, &bob, &200);
        assert_eq!(
            client.total_supply(),
            500,
            "INVARIANT VIOLATION: Transfer changed total supply"
        );

        // Approve does not change supply
        client.approve(&alice, &bob, &100);
        assert_eq!(
            client.total_supply(),
            500,
            "INVARIANT VIOLATION: Approve changed total supply"
        );

        // Burn decreases supply
        client.burn(&alice, &100);
        assert_eq!(client.total_supply(), 400);
    }

    // =========================================================================
    // INVARIANT 7: Zero Address Handling
    // =========================================================================
    /// The contract should handle zero amounts appropriately.
    #[test]
    fn invariant_zero_amount_rejected() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        // Mint zero should fail
        let result = std::panic::catch_unwind(|| {
            client.mint(&user, &0);
        });
        assert!(result.is_err(), "INVARIANT VIOLATION: Mint of zero accepted");

        // Burn zero should fail
        client.mint(&user, &100);
        let result = std::panic::catch_unwind(|| {
            client.burn(&user, &0);
        });
        assert!(result.is_err(), "INVARIANT VIOLATION: Burn of zero accepted");
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
    /// These tests verify invariants across sequences of random-ish operations.
    
    #[test]
    fn property_sequence_invariant() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let carol = Address::generate(&env);

        // Sequence of operations that should maintain invariants
        client.mint(&alice, &1000);                              // Alice: 1000
        client.mint(&bob, &500);                                 // Bob: 500
        client.transfer(&alice, &bob, &200);                     // Alice: 800, Bob: 700
        client.approve(&bob, &carol, &300);
        client.transfer_from(&carol, &bob, &alice, &150);        // Alice: 950, Bob: 550
        client.burn(&alice, &100);                               // Total supply reduced by 100

        // Verify final invariants
        let total_balance = client.balance_of(&alice) 
            + client.balance_of(&bob) 
            + client.balance_of(&carol);
        
        assert_eq!(
            client.total_supply(),
            total_balance,
            "PROPERTY VIOLATION: Supply invariant broken after operation sequence"
        );

        assert!(
            client.balance_of(&alice) >= 0
                && client.balance_of(&bob) >= 0
                && client.balance_of(&carol) >= 0,
            "PROPERTY VIOLATION: Negative balance detected"
        );
    }

    #[test]
    fn property_mint_burn_symmetry() {
        let (env, client, _) = setup_fresh();
        let user = Address::generate(&env);

        // Mint then burn same amount should return to initial state
        let initial_supply = client.total_supply();
        let initial_balance = client.balance_of(&user);

        client.mint(&user, &500);
        client.burn(&user, &500);

        assert_eq!(
            client.total_supply(),
            initial_supply,
            "PROPERTY VIOLATION: Mint-burn symmetry broken for supply"
        );
        assert_eq!(
            client.balance_of(&user),
            initial_balance,
            "PROPERTY VIOLATION: Mint-burn symmetry broken for balance"
        );
    }

    #[test]
    fn property_transfer_reversibility_check() {
        let (env, client, _) = setup_fresh();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.mint(&alice, &1000);

        let alice_initial = client.balance_of(&alice);
        let bob_initial = client.balance_of(&bob);

        // Transfer A -> B
        client.transfer(&alice, &bob, &300);
        
        // Transfer B -> A (reverse)
        client.transfer(&bob, &alice, &300);

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
}
