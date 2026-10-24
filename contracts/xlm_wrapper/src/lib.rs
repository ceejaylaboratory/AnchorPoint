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
    /// Maximum total supply cap for wrapped tokens
    MaxSupply,
    /// Per-account trustline count used when calculating the minimum reserve.
    /// Stored as u32; defaults to 0 (only the base account reserve applies).
    TrustlineCount(Address),
}

// ── Reserve constants ────────────────────────────────────────────────────────
/// Base reserve per ledger entry in stroops (0.5 XLM = 5_000_000 stroops).
/// Source: Stellar Core – each account needs at least 2 base reserves (1 XLM)
/// for the account entry itself, plus 1 base reserve per additional trustline.
const BASE_RESERVE_STROOPS: i128 = 5_000_000; // 0.5 XLM in stroops (7 decimals)

/// Minimum number of base-reserve entries every account must hold.
/// An unfunded account requires 2 reserves (the account entry counts as 2).
const MIN_ACCOUNT_ENTRIES: i128 = 2;
// ─────────────────────────────────────────────────────────────────────────────

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
        env.events().publish(
            (symbol_short!("init"),),
            (admin, token, name, symbol, native_asset),
        );
    }

    /// Deposit native XLM to mint wXLM tokens (1:1 ratio)
    ///
    /// Before transferring the XLM this function verifies that the depositor
    /// will retain at least the Stellar network minimum reserve after the
    /// deposit.  The minimum reserve is:
    ///
    ///   `(MIN_ACCOUNT_ENTRIES + trustline_count) × BASE_RESERVE_STROOPS`
    ///
    /// where `BASE_RESERVE_STROOPS` = 5_000_000 (0.5 XLM) and
    /// `MIN_ACCOUNT_ENTRIES` = 2 (the base account entry requirement).
    ///
    /// If the requested `amount` would reduce the account's native XLM balance
    /// below this threshold the call is rejected with
    /// `"InsufficientReserve: deposit would violate minimum network reserve"`.
    ///
    /// # Arguments
    /// * `from`   - Address depositing XLM
    /// * `amount` - Amount of native XLM (in stroops) to deposit
    ///
    /// # Returns
    /// Amount of wXLM minted (always equal to `amount` — 1:1 peg)
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        from.require_auth();

        Self::check_not_paused(&env);
        assert!(amount > 0, "amount must be positive");

        // ── Minimum reserve check ────────────────────────────────────────────
        // Fetch the depositor's current native XLM balance before transfer.
        let native_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::NativeAsset)
            .expect("native asset not set");
        let current_balance: i128 =
            token::Client::new(&env, &native_asset).balance(&from);

        // Additional trustlines held by this account (stored off-chain; default 0).
        let trustline_count: i128 = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::TrustlineCount(from.clone()))
            .unwrap_or(0) as i128;

        // Minimum balance that must remain after the deposit.
        let min_reserve: i128 = (MIN_ACCOUNT_ENTRIES + trustline_count)
            .checked_mul(BASE_RESERVE_STROOPS)
            .expect("reserve overflow");

        // Available balance is what the account can safely spend without
        // dropping below the network minimum reserve.
        let available: i128 = current_balance.saturating_sub(min_reserve);

        if amount > available {
            panic!(
                "InsufficientReserve: deposit would violate minimum network reserve \
                 (available={}, requested={}, min_reserve={})",
                available, amount, min_reserve
            );
        }
        // ────────────────────────────────────────────────────────────────────

        // Receive native XLM from user (reserve check already passed above).
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &native_asset)
            .transfer(&from, &contract_addr, &amount);
        
        // Enforce supply cap if one has been set
        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        if let Some(max_supply) = env.storage().instance().get::<_, i128>(&DataKey::MaxSupply) {
            if supply.checked_add(amount).unwrap_or(i128::MAX) > max_supply {
                panic!("SupplyCapExceeded");
            }
        }

        // Mint wXLM to user (1:1 ratio)
        let bal = Self::balance_of(env.clone(), from.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(bal + amount));

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
        Self::burn_and_release(&env, &from, amount);

        env.events()
            .publish((symbol_short!("withdraw"), from), amount);

        amount
    }

    /// Unwrap wXLM back into native XLM (1:1 ratio).
    ///
    /// Burns `amount` wXLM from `from`, decrements the total supply and
    /// transfers the same amount of native XLM from the contract's reserve
    /// back to `from`. State is updated before the native transfer so a
    /// failing transfer reverts the burn as well.
    ///
    /// # Arguments
    /// * `from` - Address unwrapping wXLM (must authorize the call)
    /// * `amount` - Amount of wXLM to burn, in stroops
    ///
    /// # Returns
    /// Amount of native XLM released (always equal to `amount` — 1:1 peg)
    pub fn unwrap(env: Env, from: Address, amount: i128) -> i128 {
        from.require_auth();
        Self::burn_and_release(&env, &from, amount);

        env.events()
            .publish((symbol_short!("unwrap"), from), amount);

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

    /// Record the number of non-native trustlines held by an account so that
    /// the reserve calculation inside `deposit` can account for them.
    ///
    /// In production this is typically called by a trusted oracle / relayer
    /// whenever an account's trustline set changes.  Only the admin may call
    /// this to prevent manipulation.
    ///
    /// # Arguments
    /// * `admin`           - Administrator address
    /// * `account`         - The account whose trustline count is being updated
    /// * `trustline_count` - Number of non-native trustlines (≥ 0)
    pub fn set_trustline_count(
        env: Env,
        admin: Address,
        account: Address,
        trustline_count: u32,
    ) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");

        env.storage()
            .instance()
            .set(&DataKey::TrustlineCount(account.clone()), &trustline_count);

        env.events()
            .publish((symbol_short!("tl_count"), account), trustline_count);
    }

    /// Return the minimum XLM reserve (in stroops) that must remain in an
    /// account after a deposit, given the stored trustline count.
    ///
    /// # Arguments
    /// * `account` - The account to query
    pub fn get_min_reserve(env: Env, account: Address) -> i128 {
        let trustline_count: i128 = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::TrustlineCount(account))
            .unwrap_or(0) as i128;
        (MIN_ACCOUNT_ENTRIES + trustline_count)
            .checked_mul(BASE_RESERVE_STROOPS)
            .expect("reserve overflow")
    }

    /// Set maximum total supply cap for wrapped tokens
    /// Pass `0` to remove the cap entirely.
    ///
    /// # Arguments
    /// * `admin` - Administrator address
    /// * `max_supply` - New cap; set to 0 to disable
    pub fn set_max_supply(env: Env, admin: Address, max_supply: i128) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        assert!(max_supply >= 0, "max_supply must be non-negative");

        if max_supply == 0 {
            env.storage().instance().remove(&DataKey::MaxSupply);
        } else {
            env.storage().instance().set(&DataKey::MaxSupply, &max_supply);
        }
        env.events()
            .publish((symbol_short!("set_cap"), admin), max_supply);
    }

    /// Return current supply cap; returns 0 when no cap is set.
    pub fn get_max_supply(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MaxSupply)
            .unwrap_or(0)
    }

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

    /// Burn `amount` wXLM from `from`, decrement total supply and send the
    /// matching native XLM back. Shared by `withdraw` and `unwrap`; callers
    /// must have already checked `from.require_auth()`.
    fn burn_and_release(env: &Env, from: &Address, amount: i128) {
        Self::check_not_paused(env);
        assert!(amount > 0, "amount must be positive");

        let bal = Self::balance_of(env.clone(), from.clone());
        assert!(bal >= amount, "insufficient balance");

        let supply: i128 = env.storage().instance().get(&DataKey::TotalSupply).unwrap_or(0);
        let new_supply = supply.checked_sub(amount).expect("supply underflow");

        // Burn wXLM from user
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone()), &(bal - amount));
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &new_supply);

        // Send native XLM back to user
        let native_asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::NativeAsset)
            .expect("native asset not set");
        token::Client::new(env, &native_asset)
            .transfer(&env.current_contract_address(), from, &amount);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, AuthorizedFunction};
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
        // Mint enough to cover the deposit PLUS the mandatory 2-entry base
        // reserve (2 × 5_000_000 = 10_000_000 stroops) so that the minimum-
        // reserve check inside deposit() does not reject the call.
        te.sac.mint(user, &(amount + 10_000_000));
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
        // The paused check fires before the reserve check, so any amount works.
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
    fn test_set_and_get_max_supply() {
        let te = setup();
        assert_eq!(te.client.get_max_supply(), 0);
        te.client.set_max_supply(&te.admin, &5000);
        assert_eq!(te.client.get_max_supply(), 5000);
    }

    #[test]
    fn test_deposit_within_cap() {
        let te = setup();
        te.client.set_max_supply(&te.admin, &2000);
        let user = Address::generate(&te.env);
        fund_user(&te, &user, 2000);
        te.client.deposit(&user, &2000);
        assert_eq!(te.client.total_supply(), 2000);
    }

    #[test]
    #[should_panic(expected = "SupplyCapExceeded")]
    fn test_deposit_exceeds_cap_panics() {
        let te = setup();
        te.client.set_max_supply(&te.admin, &500);
        let user = Address::generate(&te.env);
        fund_user(&te, &user, 1000);
        te.client.deposit(&user, &1000);
    }

    #[test]
    fn test_remove_cap_by_setting_zero() {
        let te = setup();
        te.client.set_max_supply(&te.admin, &500);
        assert_eq!(te.client.get_max_supply(), 500);
        te.client.set_max_supply(&te.admin, &0);
        assert_eq!(te.client.get_max_supply(), 0);
        // Deposit should now succeed without cap enforcement
        let user = Address::generate(&te.env);
        fund_user(&te, &user, 1000);
        te.client.deposit(&user, &1000);
        assert_eq!(te.client.total_supply(), 1000);
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

    // ── Unwrap tests ─────────────────────────────────────────────────────────

    #[test]
    fn test_wrap_unwrap_round_trip() {
        let te = setup();
        let user = Address::generate(&te.env);
        let native = token::Client::new(&te.env, &te.sac.address);

        fund_user(&te, &user, 1_000);
        let native_start = native.balance(&user);

        // Wrap: native XLM moves into the contract, wXLM is minted.
        te.client.deposit(&user, &1_000);
        assert_eq!(te.client.balance_of(&user), 1_000);
        assert_eq!(te.client.total_supply(), 1_000);
        assert_eq!(native.balance(&user), native_start - 1_000);
        assert_eq!(native.balance(&te.client.address), 1_000);

        // Partial unwrap burns wXLM and releases the same amount of XLM.
        assert_eq!(te.client.unwrap(&user, &400), 400);
        assert_eq!(te.client.balance_of(&user), 600);
        assert_eq!(te.client.total_supply(), 600);
        assert_eq!(native.balance(&user), native_start - 600);
        assert_eq!(native.balance(&te.client.address), 600);

        // Unwrapping the rest restores the starting balances exactly.
        te.client.unwrap(&user, &600);
        assert_eq!(te.client.balance_of(&user), 0);
        assert_eq!(te.client.total_supply(), 0);
        assert_eq!(native.balance(&user), native_start);
        assert_eq!(native.balance(&te.client.address), 0);
    }

    #[test]
    fn test_unwrap_only_burns_callers_balance() {
        let te = setup();
        let alice = Address::generate(&te.env);
        let bob = Address::generate(&te.env);

        fund_user(&te, &alice, 1_000);
        fund_user(&te, &bob, 500);
        te.client.deposit(&alice, &1_000);
        te.client.deposit(&bob, &500);

        te.client.unwrap(&alice, &250);

        assert_eq!(te.client.balance_of(&alice), 750);
        assert_eq!(te.client.balance_of(&bob), 500);
        assert_eq!(te.client.total_supply(), 1_250);
    }

    #[test]
    fn test_unwrap_requires_holder_auth() {
        let te = setup();
        let user = Address::generate(&te.env);
        fund_user(&te, &user, 1_000);
        te.client.deposit(&user, &1_000);

        te.client.unwrap(&user, &100);

        let auths = te.env.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, user);
        match &auths[0].1.function {
            AuthorizedFunction::Contract((contract, func, _)) => {
                assert_eq!(*contract, te.client.address);
                assert_eq!(*func, soroban_sdk::Symbol::new(&te.env, "unwrap"));
            }
            _ => panic!("expected a contract invocation"),
        }
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn test_unwrap_more_than_balance_rejected() {
        let te = setup();
        let user = Address::generate(&te.env);
        fund_user(&te, &user, 100);
        te.client.deposit(&user, &100);
        te.client.unwrap(&user, &101);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_unwrap_zero_rejected() {
        let te = setup();
        let user = Address::generate(&te.env);
        fund_user(&te, &user, 100);
        te.client.deposit(&user, &100);
        te.client.unwrap(&user, &0);
    }

    #[test]
    #[should_panic(expected = "contract is paused")]
    fn test_unwrap_when_paused() {
        let te = setup();
        let user = Address::generate(&te.env);
        fund_user(&te, &user, 100);
        te.client.deposit(&user, &100);
        te.client.pause(&te.admin);
        te.client.unwrap(&user, &100);
    }

    // ── Minimum reserve tests ────────────────────────────────────────────────

    #[test]
    fn test_deposit_respects_base_reserve() {
        // BASE RESERVE = 2 × 5_000_000 = 10_000_000 stroops (1 XLM).
        // Fund the user with exactly 1 XLM above the reserve so a deposit
        // of that 1 XLM should succeed while a deposit of 1 stroop more fails.
        let te = setup();
        let user = Address::generate(&te.env);

        // Fund with 20_000_000 (2 XLM).  Reserve = 10_000_000.  Available = 10_000_000.
        fund_user(&te, &user, 20_000_000);

        // Depositing exactly the available 10_000_000 stroops must succeed.
        te.client.deposit(&user, &10_000_000);
        assert_eq!(te.client.balance_of(&user), 10_000_000);
    }

    #[test]
    #[should_panic(expected = "InsufficientReserve")]
    fn test_deposit_below_base_reserve_rejected() {
        // Fund the user with exactly the minimum reserve (10_000_000) so
        // they have zero available to deposit — any positive deposit must fail.
        let te = setup();
        let user = Address::generate(&te.env);

        // Fund with exactly the base reserve amount.
        fund_user(&te, &user, 10_000_000);

        // Attempting to deposit 1 stroop would drop balance below min reserve.
        te.client.deposit(&user, &1);
    }

    #[test]
    #[should_panic(expected = "InsufficientReserve")]
    fn test_deposit_exceeding_available_balance_rejected() {
        // User has 15_000_000 stroops.  Reserve = 10_000_000.  Available = 5_000_000.
        // Depositing 5_000_001 must fail.
        let te = setup();
        let user = Address::generate(&te.env);

        fund_user(&te, &user, 15_000_000);
        te.client.deposit(&user, &5_000_001);
    }

    #[test]
    fn test_get_min_reserve_default() {
        // Without any trustlines the minimum reserve should be
        // 2 × BASE_RESERVE = 10_000_000 stroops.
        let te = setup();
        let user = Address::generate(&te.env);
        assert_eq!(te.client.get_min_reserve(&user), 10_000_000);
    }

    #[test]
    fn test_get_min_reserve_with_trustlines() {
        // With 3 trustlines: (2 + 3) × 5_000_000 = 25_000_000 stroops.
        let te = setup();
        let user = Address::generate(&te.env);

        te.client.set_trustline_count(&te.admin, &user, &3u32);
        assert_eq!(te.client.get_min_reserve(&user), 25_000_000);
    }

    #[test]
    #[should_panic(expected = "InsufficientReserve")]
    fn test_deposit_with_trustlines_enforces_higher_reserve() {
        // Account has 3 trustlines: reserve = (2+3)×5_000_000 = 25_000_000.
        // Fund with 30_000_000 → available = 5_000_000.
        // Depositing 5_000_001 must fail.
        let te = setup();
        let user = Address::generate(&te.env);

        te.client.set_trustline_count(&te.admin, &user, &3u32);
        fund_user(&te, &user, 30_000_000);
        te.client.deposit(&user, &5_000_001);
    }

    #[test]
    fn test_deposit_with_trustlines_within_available() {
        // Account has 2 trustlines: reserve = (2+2)×5_000_000 = 20_000_000.
        // Fund with 30_000_000 → available = 10_000_000.
        // Depositing exactly 10_000_000 must succeed.
        let te = setup();
        let user = Address::generate(&te.env);

        te.client.set_trustline_count(&te.admin, &user, &2u32);
        fund_user(&te, &user, 30_000_000);
        te.client.deposit(&user, &10_000_000);
        assert_eq!(te.client.balance_of(&user), 10_000_000);
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
        // Always mint amount + base reserve (10_000_000 stroops) so that the
        // minimum-reserve guard inside deposit() does not reject the call.
        sac.mint(user, &(amount + 10_000_000));
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
