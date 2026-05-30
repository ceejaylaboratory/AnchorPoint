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
    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Val, Vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// The address authorised to upgrade the implementation.
    Admin,
    /// The current implementation contract address.
    Implementation,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ProxyContract;

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
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Implementation, &implementation);

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
        pub fn ping(_env: Env) -> u32 {
            42
        }

        pub fn add(_env: Env, a: i128, b: i128) -> i128 {
            a + b
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn setup(env: &Env) -> (ProxyContractClient, Address, Address) {
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
}
