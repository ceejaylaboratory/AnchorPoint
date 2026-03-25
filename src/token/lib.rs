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
        owner.require_auth();
        assert!(amount >= 0, "amount must be non-negative");
        env.storage().persistent().set(&DataKey::Allowance(owner.clone(), spender.clone()), &amount);
        env.events().publish((symbol_short!("approve"), owner, spender), amount);
    }

    pub fn transfer_from(env: Env, spender: Address, from: Address, to: Address, amount: i128) {
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
