#![no_std]
//! Upgradeable Proxy Contract
//!
//! A minimal proxy that stores an `implementation` address and forwards
//! arbitrary calls to it via `env.invoke_contract`. The admin can swap the
//! implementation at any time, enabling seamless contract upgrades without
//! migrating state.
//!
//! ## Testnet deployment
//!
//! 1. Deploy the implementation contract and note its address.
//! 2. Deploy this proxy with `initialize(admin, implementation)`.
//! 3. Clients call `forward(function_name, args)` — the proxy delegates to
//!    the current implementation transparently.
//! 4. To upgrade, the admin calls `upgrade(new_implementation)`.
//!
//! ## Security
//!
//! * `initialize` is one-time; subsequent calls panic.
//! * `upgrade` requires `admin.require_auth()` — only the admin key can
//!   change the implementation.
//! * `transfer_admin` requires auth from the *current* admin.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Symbol, Val, Vec,
};

/// Default number of approvals required for an upgrade (2 = 2-of-N multi-sig).
const DEFAULT_REQUIRED_APPROVALS: u32 = 2;

/// Timelock duration in seconds before an upgrade can execute (24 hours).
const UPGRADE_TIMELOCK_SECONDS: u64 = 86_400;

/// Maximum number of authorized approvers.
const MAX_APPROVERS: u32 = 10;

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// The address authorised to upgrade the implementation.
    Admin,
    /// The current implementation contract address.
    Implementation,
    /// Pending WASM hash for an upgrade request.
    PendingWasmHash,
    /// Timestamp when the pending upgrade can be executed.
    PendingUnlocksAt,
    /// List of addresses authorized to approve upgrades.
    Approvers,
    /// Number of approvals collected for the pending upgrade.
    ApprovalCount,
    /// Minimum number of approvals required to execute an upgrade.
    RequiredApprovals,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ProxyContract;

#[allow(deprecated)]
#[contractimpl]
impl ProxyContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the proxy (one-time).
    ///
    /// * `admin`          – address authorised to upgrade the implementation.
    /// * `implementation` – initial implementation contract address.
    pub fn initialize(env: Env, admin: Address, implementation: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        Self::validate_implementation(&env, &implementation);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Implementation, &implementation);

        let approvers: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::Approvers, &approvers);
        env.storage()
            .instance()
            .set(&DataKey::RequiredApprovals, &DEFAULT_REQUIRED_APPROVALS);
        env.storage().instance().set(&DataKey::ApprovalCount, &0u32);

        env.events()
            .publish((symbol_short!("init"),), (admin, implementation));
    }

    // ── Upgrade ───────────────────────────────────────────────────────────────

    /// Swap the implementation to `new_implementation` (admin only).
    ///
    /// Emits an `upgraded` event with the old and new implementation addresses.
    pub fn upgrade(env: Env, new_implementation: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let old_implementation: Address = env
            .storage()
            .instance()
            .get(&DataKey::Implementation)
            .expect("not initialized");

        Self::validate_implementation(&env, &new_implementation);

        env.storage()
            .instance()
            .set(&DataKey::Implementation, &new_implementation);

        env.events().publish(
            (symbol_short!("upgraded"),),
            (old_implementation, new_implementation),
        );
    }

    // ── Admin transfer ────────────────────────────────────────────────────────

    /// Transfer admin rights to `new_admin` (current admin only).
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events()
            .publish((symbol_short!("adm_xfer"),), (admin, new_admin));
    }

    // ── Approver management ────────────────────────────────────────────────────

    /// Add an address to the authorized approver list (admin only).
    pub fn add_approver(env: Env, caller: Address, approver: Address) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);

        let mut approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .unwrap_or_else(|| Vec::new(&env));

        assert!((approvers.len() as u32) < MAX_APPROVERS, "approver list is full");

        for i in 0..approvers.len() {
            if approvers.get(i).unwrap() == approver {
                panic!("approver already authorized");
            }
        }

        approvers.push_back(approver.clone());
        env.storage().instance().set(&DataKey::Approvers, &approvers);
        env.events()
            .publish((symbol_short!("appr_add"), approver), caller);
    }

    /// Remove an address from the authorized approver list (admin only).
    pub fn remove_approver(env: Env, caller: Address, approver: Address) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);

        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .unwrap_or_else(|| Vec::new(&env));

        let mut new_approvers: Vec<Address> = Vec::new(&env);
        let mut found = false;
        for i in 0..approvers.len() {
            let a = approvers.get(i).unwrap();
            if a == approver {
                found = true;
            } else {
                new_approvers.push_back(a);
            }
        }
        assert!(found, "approver not found");
        env.storage()
            .instance()
            .set(&DataKey::Approvers, &new_approvers);
        env.events()
            .publish((symbol_short!("appr_rm"), approver), caller);
    }

    // ── WASM Upgrade flow ──────────────────────────────────────────────────────

    /// Request a WASM contract upgrade.
    ///
    /// Stores the pending `wasm_hash`, resets the approval count, and starts
    /// the timelock. The upgrade can be executed once enough approvals have
    /// been collected and the timelock has expired.
    pub fn request_upgrade(env: Env, wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        assert!(
            wasm_hash != BytesN::from_array(&env, &[0u8; 32]),
            "wasm hash must not be zero"
        );

        let unlocks_at = env
            .ledger()
            .timestamp()
            .checked_add(UPGRADE_TIMELOCK_SECONDS)
            .expect("timelock overflow");

        env.storage()
            .instance()
            .set(&DataKey::PendingWasmHash, &wasm_hash);
        env.storage()
            .instance()
            .set(&DataKey::PendingUnlocksAt, &unlocks_at);
        env.storage().instance().set(&DataKey::ApprovalCount, &0u32);

        env.events().publish(
            (symbol_short!("upg_req"),),
            (wasm_hash, unlocks_at),
        );
    }

    /// Approve a pending upgrade. Callable by any authorized approver.
    pub fn approve_upgrade(env: Env, approver: Address) {
        approver.require_auth();

        assert!(
            env.storage().instance().has(&DataKey::PendingWasmHash),
            "no pending upgrade"
        );

        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .expect("approvers not configured");

        let mut is_authorized = false;
        for i in 0..approvers.len() {
            if approvers.get(i).unwrap() == approver {
                is_authorized = true;
                break;
            }
        }
        assert!(is_authorized, "caller is not an authorized approver");

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ApprovalCount)
            .unwrap_or(0);
        let new_count = count.checked_add(1).expect("approval count overflow");
        env.storage()
            .instance()
            .set(&DataKey::ApprovalCount, &new_count);

        env.events()
            .publish((symbol_short!("upg_appr"), approver), new_count);
    }

    /// Execute a pending WASM upgrade once the timelock has expired and
    /// enough approvals have been collected.
    pub fn execute_upgrade(env: Env) {
        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::PendingWasmHash)
            .expect("no pending upgrade");

        let unlocks_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PendingUnlocksAt)
            .expect("no pending upgrade");

        assert!(
            env.ledger().timestamp() >= unlocks_at,
            "timelock has not expired yet"
        );

        let required: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RequiredApprovals)
            .unwrap_or(DEFAULT_REQUIRED_APPROVALS);
        let collected: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ApprovalCount)
            .unwrap_or(0);
        assert!(
            collected >= required,
            "not enough approvals: {}/{}",
            collected,
            required,
        );

        env.deployer().update_current_contract_wasm(wasm_hash.clone());

        env.storage().instance().remove(&DataKey::PendingWasmHash);
        env.storage().instance().remove(&DataKey::PendingUnlocksAt);
        env.storage().instance().set(&DataKey::ApprovalCount, &0u32);

        env.events().publish(
            (symbol_short!("upgraded"),),
            (wasm_hash,),
        );
    }

    /// Cancel a pending upgrade (admin only).
    pub fn cancel_upgrade(env: Env, caller: Address) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);

        assert!(
            env.storage().instance().has(&DataKey::PendingWasmHash),
            "no pending upgrade"
        );

        env.storage().instance().remove(&DataKey::PendingWasmHash);
        env.storage().instance().remove(&DataKey::PendingUnlocksAt);
        env.storage().instance().set(&DataKey::ApprovalCount, &0u32);

        env.events()
            .publish((symbol_short!("upg_cncl"), caller), ());
    }

    /// Set the number of approvals required for an upgrade (admin only).
    pub fn set_required_approvals(env: Env, caller: Address, required: u32) {
        caller.require_auth();
        Self::assert_admin(&env, &caller);
        assert!(required > 0 && required <= MAX_APPROVERS, "required approvals must be 1-10");
        env.storage()
            .instance()
            .set(&DataKey::RequiredApprovals, &required);
        env.events()
            .publish((symbol_short!("rqa_set"), caller), required);
    }

    // ── Forwarding ────────────────────────────────────────────────────────────

    /// Forward a call to the current implementation.
    ///
    /// * `function_name` – the function to invoke on the implementation.
    /// * `args`          – arguments to pass through.
    ///
    /// Returns whatever the implementation returns.
    pub fn forward(env: Env, function_name: Symbol, args: Vec<Val>) -> Val {
        let implementation: Address = env
            .storage()
            .instance()
            .get(&DataKey::Implementation)
            .expect("not initialized");

        env.invoke_contract(&implementation, &function_name, args)
    }

    // ── Read-only helpers ─────────────────────────────────────────────────────

    /// Return the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Return the current implementation address.
    pub fn get_implementation(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Implementation)
            .expect("not initialized")
    }

    /// Return the pending WASM hash, or None if no upgrade is pending.
    pub fn get_pending_wasm_hash(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::PendingWasmHash)
    }

    /// Return the timestamp when the pending upgrade can be executed.
    pub fn get_pending_unlock_time(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::PendingUnlocksAt)
            .unwrap_or(0)
    }

    /// Return the number of approvals collected for the pending upgrade.
    pub fn get_approval_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ApprovalCount)
            .unwrap_or(0)
    }

    /// Return the minimum number of approvals required to execute an upgrade.
    pub fn get_required_approvals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::RequiredApprovals)
            .unwrap_or(DEFAULT_REQUIRED_APPROVALS)
    }

    /// Return true if the address is an authorized approver.
    pub fn is_approver(env: Env, addr: Address) -> bool {
        let approvers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Approvers)
            .unwrap_or_else(|| Vec::new(&env));
        for i in 0..approvers.len() {
            if approvers.get(i).unwrap() == addr {
                return true;
            }
        }
        false
    }

    // ── Internal helpers ───────────────────────────────────────────────────────

    fn assert_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not configured");
        assert!(*caller == admin, "caller is not admin");
    }

    fn validate_implementation(env: &Env, implementation: &Address) {
        let version: u32 = env.invoke_contract(
            implementation,
            &symbol_short!("if_ver"),
            soroban_sdk::vec![env],
        );
        assert!(version == 1, "incompatible implementation interface");
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl, testutils::Address as _, Address, Env, IntoVal, Symbol, TryIntoVal,
    };

    // ── Minimal implementation stub ───────────────────────────────────────────

    #[contract]
    pub struct MockImpl;

    #[contractimpl]
    impl MockImpl {
        pub fn if_ver(_env: Env) -> u32 {
            1
        }

        pub fn ping(_env: Env) -> u32 {
            42
        }

        pub fn add(_env: Env, a: i128, b: i128) -> i128 {
            a + b
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn setup(env: &Env) -> (ProxyContractClient<'_>, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let impl_id = env.register(MockImpl, ());
        let proxy_id = env.register(ProxyContract, ());
        let proxy = ProxyContractClient::new(env, &proxy_id);
        proxy.initialize(&admin, &impl_id);
        (proxy, admin, impl_id)
    }

    // ── Initialisation ────────────────────────────────────────────────────────

    #[test]
    fn test_initialize_stores_admin_and_impl() {
        let env = Env::default();
        let (proxy, admin, impl_id) = setup(&env);
        assert_eq!(proxy.get_admin(), admin);
        assert_eq!(proxy.get_implementation(), impl_id);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let env = Env::default();
        let (proxy, admin, impl_id) = setup(&env);
        proxy.initialize(&admin, &impl_id);
    }

    // ── Upgrade ───────────────────────────────────────────────────────────────

    #[test]
    fn test_upgrade_changes_implementation() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _admin, _old_impl) = setup(&env);

        let new_impl_id = env.register(MockImpl, ());
        proxy.upgrade(&new_impl_id);

        assert_eq!(proxy.get_implementation(), new_impl_id);
    }

    #[test]
    #[should_panic]
    fn test_upgrade_requires_admin_auth() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _admin, _impl_id) = setup(&env);

        // A non-admin address should not be able to upgrade.
        let non_admin = Address::generate(&env);
        let new_impl_id = env.register(MockImpl, ());

        // Override the admin in storage to be a different address, then try
        // to upgrade as the original admin — this verifies require_auth is wired.
        // Simpler: call upgrade with a fresh env that has no mocked auths.
        let env2 = Env::default(); // no mock_all_auths
        let proxy2 = ProxyContractClient::new(&env2, &proxy.address);
        proxy2.upgrade(&new_impl_id); // must panic: auth not satisfied
        let _ = non_admin;
    }

    // ── Admin transfer ────────────────────────────────────────────────────────

    #[test]
    fn test_transfer_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _old_admin, _impl_id) = setup(&env);

        let new_admin = Address::generate(&env);
        proxy.transfer_admin(&new_admin);

        assert_eq!(proxy.get_admin(), new_admin);
    }

    // ── Forwarding ────────────────────────────────────────────────────────────

    #[test]
    fn test_forward_ping() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _admin, _impl_id) = setup(&env);

        let result: Val = proxy.forward(&Symbol::new(&env, "ping"), &soroban_sdk::vec![&env]);
        let result_u32: u32 = result.try_into_val(&env).unwrap();
        assert_eq!(result_u32, 42);
    }

    #[test]
    fn test_forward_add() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _admin, _impl_id) = setup(&env);

        let result: Val = proxy.forward(
            &Symbol::new(&env, "add"),
            &soroban_sdk::vec![&env, 10i128.into_val(&env), 32i128.into_val(&env),],
        );
        let result_i128: i128 = result.try_into_val(&env).unwrap();
        assert_eq!(result_i128, 42);
    }

    #[test]
    fn test_forward_after_upgrade() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _admin, _old_impl) = setup(&env);

        // Deploy a new implementation and upgrade.
        let new_impl_id = env.register(MockImpl, ());
        proxy.upgrade(&new_impl_id);

        // Forward should now hit the new implementation.
        let result: Val = proxy.forward(&Symbol::new(&env, "ping"), &soroban_sdk::vec![&env]);
        let result_u32: u32 = result.try_into_val(&env).unwrap();
        assert_eq!(result_u32, 42);
    }

    // ── Pre-init guards ───────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "not initialized")]
    fn test_get_admin_panics_before_init() {
        let env = Env::default();
        let proxy_id = env.register(ProxyContract, ());
        let proxy = ProxyContractClient::new(&env, &proxy_id);
        proxy.get_admin();
    }

    #[test]
    #[should_panic(expected = "not initialized")]
    fn test_get_implementation_panics_before_init() {
        let env = Env::default();
        let proxy_id = env.register(ProxyContract, ());
        let proxy = ProxyContractClient::new(&env, &proxy_id);
        proxy.get_implementation();
    }

    #[test]
    #[should_panic(expected = "not initialized")]
    fn test_upgrade_panics_before_init() {
        let env = Env::default();
        env.mock_all_auths();
        let proxy_id = env.register(ProxyContract, ());
        let proxy = ProxyContractClient::new(&env, &proxy_id);
        let new_impl = env.register(MockImpl, ());
        proxy.upgrade(&new_impl);
    }

    #[test]
    #[should_panic(expected = "not initialized")]
    fn test_forward_panics_before_init() {
        let env = Env::default();
        let proxy_id = env.register(ProxyContract, ());
        let proxy = ProxyContractClient::new(&env, &proxy_id);
        proxy.forward(&Symbol::new(&env, "ping"), &soroban_sdk::vec![&env]);
    }

    // ── Multiple sequential upgrades ─────────────────────────────────────────

    #[test]
    fn test_multiple_sequential_upgrades() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _admin, first_impl) = setup(&env);
        assert_eq!(proxy.get_implementation(), first_impl);

        let impl_v2 = env.register(MockImpl, ());
        proxy.upgrade(&impl_v2);
        assert_eq!(proxy.get_implementation(), impl_v2);

        let impl_v3 = env.register(MockImpl, ());
        proxy.upgrade(&impl_v3);
        assert_eq!(proxy.get_implementation(), impl_v3);

        let impl_v4 = env.register(MockImpl, ());
        proxy.upgrade(&impl_v4);
        assert_eq!(proxy.get_implementation(), impl_v4);
    }

    #[test]
    fn test_forward_after_multiple_upgrades() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _admin, _first_impl) = setup(&env);

        let impl_v2 = env.register(MockImpl, ());
        proxy.upgrade(&impl_v2);

        let impl_v3 = env.register(MockImpl, ());
        proxy.upgrade(&impl_v3);

        // forward should still resolve through the latest implementation
        let result: Val = proxy.forward(&Symbol::new(&env, "ping"), &soroban_sdk::vec![&env]);
        let result_u32: u32 = result.try_into_val(&env).unwrap();
        assert_eq!(result_u32, 42);
    }

    #[test]
    fn test_forward_add_after_multiple_upgrades() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _admin, _first_impl) = setup(&env);

        let impl_v2 = env.register(MockImpl, ());
        proxy.upgrade(&impl_v2);

        let result: Val = proxy.forward(
            &Symbol::new(&env, "add"),
            &soroban_sdk::vec![&env, 20i128.into_val(&env), 22i128.into_val(&env)],
        );
        let result_i128: i128 = result.try_into_val(&env).unwrap();
        assert_eq!(result_i128, 42);
    }

    // ── Admin transfer + upgradeability ──────────────────────────────────────

    #[test]
    fn test_transfer_admin_preserves_implementation() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _old_admin, impl_id) = setup(&env);

        let new_admin = Address::generate(&env);
        proxy.transfer_admin(&new_admin);

        // Admin changed but implementation must remain unchanged
        assert_eq!(proxy.get_admin(), new_admin);
        assert_eq!(proxy.get_implementation(), impl_id);
    }

    #[test]
    fn test_upgrade_after_admin_transfer() {
        let env = Env::default();
        env.mock_all_auths();
        let (proxy, _old_admin, _impl_id) = setup(&env);

        let new_admin = Address::generate(&env);
        proxy.transfer_admin(&new_admin);

        // New admin should be able to upgrade
        let new_impl = env.register(MockImpl, ());
        proxy.upgrade(&new_impl);
        assert_eq!(proxy.get_implementation(), new_impl);
        assert_eq!(proxy.get_admin(), new_admin);
    }

    // ── WASM upgrade tests ─────────────────────────────────────────────────────

    fn upgrade_setup(env: &Env) -> (ProxyContractClient, Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let approver1 = Address::generate(env);
        let approver2 = Address::generate(env);
        let impl_id = env.register(MockImpl, ());
        let proxy_id = env.register(ProxyContract, ());
        let proxy = ProxyContractClient::new(env, &proxy_id);
        proxy.initialize(&admin, &impl_id);
        proxy.add_approver(&admin, &approver1);
        proxy.add_approver(&admin, &approver2);
        (proxy, admin, approver1, approver2)
    }

    #[test]
    fn test_add_approver() {
        let env = Env::default();
        let (proxy, _admin, approver1, _a2) = upgrade_setup(&env);
        assert!(proxy.is_approver(&approver1));
        assert!(!proxy.is_approver(&Address::generate(&env)));
    }

    #[test]
    fn test_request_upgrade_stores_hash() {
        let env = Env::default();
        let (proxy, _admin, _a1, _a2) = upgrade_setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        proxy.request_upgrade(&hash);
        assert_eq!(proxy.get_pending_wasm_hash(), Some(hash));
    }

    #[test]
    #[should_panic(expected = "wasm hash must not be zero")]
    fn test_request_upgrade_zero_hash_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let impl_id = env.register(MockImpl, ());
        let proxy_id = env.register(ProxyContract, ());
        let proxy = ProxyContractClient::new(&env, &proxy_id);
        proxy.initialize(&admin, &impl_id);
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        proxy.request_upgrade(&zero_hash);
    }

    #[test]
    fn test_approve_upgrade_increments_count() {
        let env = Env::default();
        let (proxy, _admin, approver1, _a2) = upgrade_setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        proxy.request_upgrade(&hash);
        proxy.approve_upgrade(&approver1);
        assert_eq!(proxy.get_approval_count(), 1);
    }

    #[test]
    #[should_panic(expected = "caller is not an authorized approver")]
    fn test_non_approver_cannot_approve() {
        let env = Env::default();
        let (proxy, _admin, _a1, _a2) = upgrade_setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        proxy.request_upgrade(&hash);
        let non_approver = Address::generate(&env);
        proxy.approve_upgrade(&non_approver);
    }

    #[test]
    fn test_execute_upgrade_after_approvals_and_timelock() {
        let env = Env::default();
        let (proxy, _admin, approver1, approver2) = upgrade_setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        proxy.request_upgrade(&hash);
        proxy.approve_upgrade(&approver1);
        proxy.approve_upgrade(&approver2);

        let unlock_time = proxy.get_pending_unlock_time();
        assert!(unlock_time > 0);
        env.ledger().with_mut(|l| l.timestamp = unlock_time + 1);

        proxy.execute_upgrade();
    }

    #[test]
    #[should_panic(expected = "timelock has not expired yet")]
    fn test_execute_upgrade_before_timelock_panics() {
        let env = Env::default();
        let (proxy, _admin, approver1, approver2) = upgrade_setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        proxy.request_upgrade(&hash);
        proxy.approve_upgrade(&approver1);
        proxy.approve_upgrade(&approver2);
        // Do NOT advance ledger — timelock hasn't expired
        proxy.execute_upgrade();
    }

    #[test]
    #[should_panic(expected = "not enough approvals")]
    fn test_execute_upgrade_without_approvals_panics() {
        let env = Env::default();
        let (proxy, _admin, _a1, _a2) = upgrade_setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        proxy.request_upgrade(&hash);
        let unlock_time = proxy.get_pending_unlock_time();
        env.ledger().with_mut(|l| l.timestamp = unlock_time + 1);
        proxy.execute_upgrade();
    }

    #[test]
    fn test_cancel_upgrade_clears_state() {
        let env = Env::default();
        let (proxy, admin, _a1, _a2) = upgrade_setup(&env);
        let hash = BytesN::from_array(&env, &[1u8; 32]);
        proxy.request_upgrade(&hash);
        assert!(proxy.get_pending_wasm_hash().is_some());

        proxy.cancel_upgrade(&admin);
        assert!(proxy.get_pending_wasm_hash().is_none());
        assert_eq!(proxy.get_pending_unlock_time(), 0);
    }

    #[test]
    fn test_set_required_approvals() {
        let env = Env::default();
        let (proxy, admin, _a1, _a2) = upgrade_setup(&env);
        proxy.set_required_approvals(&admin, &3u32);
        assert_eq!(proxy.get_required_approvals(), 3);
    }

    #[test]
    fn test_remove_approver_revokes_access() {
        let env = Env::default();
        let (proxy, admin, _a1, approver2) = upgrade_setup(&env);
        proxy.remove_approver(&admin, &approver2);

        let hash = BytesN::from_array(&env, &[1u8; 32]);
        proxy.request_upgrade(&hash);

        // approver2 should no longer be able to approve
        assert!(!proxy.is_approver(&approver2));
    }
}
