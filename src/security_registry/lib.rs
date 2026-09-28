#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    SuperAdmin,
    IsPaused,
    /// Pause status per individual registered contract
    ContractPaused(Address),
    /// Granular per-operation pause flags (see [`PauseState`]).
    PauseFlags,
}

/// Granular pause levels, letting the security team halt risky operations
/// (e.g. deposits) while keeping others (e.g. withdrawals) available.
///
/// These flags complement the global `is_paused` kill switch: when the global
/// pause is active every operation is reported as paused regardless of flags.
#[contracttype]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PauseState {
    pub deposits_paused: bool,
    pub withdrawals_paused: bool,
    pub swaps_paused: bool,
}

#[contract]
pub struct SecurityRegistry;

#[contractimpl]
impl SecurityRegistry {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::SuperAdmin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::SuperAdmin, &admin);
        env.storage().instance().set(&DataKey::IsPaused, &false);

        anchorpoint_utils::storage::extend_instance_ttl(
            &env,
            anchorpoint_utils::storage::INSTANCE_THRESHOLD,
            anchorpoint_utils::storage::INSTANCE_EXTEND_TO,
        );
    }

    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("not super admin");
        }
        env.storage().instance().set(&DataKey::IsPaused, &true);

        anchorpoint_utils::storage::extend_instance_ttl(
            &env,
            anchorpoint_utils::storage::INSTANCE_THRESHOLD,
            anchorpoint_utils::storage::INSTANCE_EXTEND_TO,
        );
    }

    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("not super admin");
        }
        env.storage().instance().set(&DataKey::IsPaused, &false);

        anchorpoint_utils::storage::extend_instance_ttl(
            &env,
            anchorpoint_utils::storage::INSTANCE_THRESHOLD,
            anchorpoint_utils::storage::INSTANCE_EXTEND_TO,
        );
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    // -------------------------------------------------------------------------
    // Granular pause levels
    // -------------------------------------------------------------------------

    /// Replace the granular pause flags (super admin only).
    pub fn set_pause_flags(env: Env, admin: Address, flags: PauseState) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("not super admin");
        }
        env.storage().instance().set(&DataKey::PauseFlags, &flags);

        anchorpoint_utils::storage::extend_instance_ttl(
            &env,
            anchorpoint_utils::storage::INSTANCE_THRESHOLD,
            anchorpoint_utils::storage::INSTANCE_EXTEND_TO,
        );
    }

    /// Returns the granular pause flags as configured by the admin.
    ///
    /// This does not reflect the global pause; use the `is_*_paused` helpers
    /// for the effective state of an operation.
    pub fn get_pause_flags(env: Env) -> PauseState {
        env.storage()
            .instance()
            .get(&DataKey::PauseFlags)
            .unwrap_or_default()
    }

    /// Returns true if deposits are halted, either globally or granularly.
    pub fn is_deposit_paused(env: Env) -> bool {
        Self::is_paused(env.clone()) || Self::get_pause_flags(env).deposits_paused
    }

    /// Returns true if withdrawals are halted, either globally or granularly.
    pub fn is_withdraw_paused(env: Env) -> bool {
        Self::is_paused(env.clone()) || Self::get_pause_flags(env).withdrawals_paused
    }

    /// Returns true if swaps are halted, either globally or granularly.
    pub fn is_swap_paused(env: Env) -> bool {
        Self::is_paused(env.clone()) || Self::get_pause_flags(env).swaps_paused
    }

    // -------------------------------------------------------------------------
    // Per-contract pause registry
    // -------------------------------------------------------------------------

    /// Pause a specific registered contract.
    pub fn pause_contract(env: Env, admin: Address, contract_id: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("not super admin");
        }
        env.storage()
            .persistent()
            .set(&DataKey::ContractPaused(contract_id), &true);
    }

    /// Unpause a specific registered contract.
    pub fn unpause_contract(env: Env, admin: Address, contract_id: Address) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("not super admin");
        }
        env.storage()
            .persistent()
            .set(&DataKey::ContractPaused(contract_id), &false);
    }

    /// Read-only query returning whether a specific contract is paused.
    pub fn is_contract_paused(env: Env, contract_id: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::ContractPaused(contract_id))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{storage::Instance as _, Address as _};

    #[test]
    fn test_pause_unpause() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(SecurityRegistry, ());
        let client = SecurityRegistryClient::new(&env, &contract_id);

        client.initialize(&admin);
        assert!(!client.is_paused());

        let initial_ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(initial_ttl >= anchorpoint_utils::storage::INSTANCE_EXTEND_TO);

        env.mock_all_auths();
        client.pause(&admin);
        assert!(client.is_paused());

        client.unpause(&admin);
        assert!(!client.is_paused());

        let pause_ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(pause_ttl >= anchorpoint_utils::storage::INSTANCE_EXTEND_TO);

        client.unpause(&admin);
        assert!(!client.is_paused());

        let unpause_ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
        assert!(unpause_ttl >= anchorpoint_utils::storage::INSTANCE_EXTEND_TO);
    }

    #[test]
    fn test_is_contract_paused_default_false() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let registry_id = env.register(SecurityRegistry, ());
        let client = SecurityRegistryClient::new(&env, &registry_id);
        client.initialize(&admin);

        let some_contract = Address::generate(&env);
        assert!(!client.is_contract_paused(&some_contract));
    }

    #[test]
    fn test_pause_and_query_specific_contract() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let registry_id = env.register(SecurityRegistry, ());
        let client = SecurityRegistryClient::new(&env, &registry_id);
        client.initialize(&admin);

        let target = Address::generate(&env);
        let other = Address::generate(&env);

        assert!(!client.is_contract_paused(&target));

        client.pause_contract(&admin, &target);
        assert!(client.is_contract_paused(&target));
        // Other contract must remain unaffected
        assert!(!client.is_contract_paused(&other));

        client.unpause_contract(&admin, &target);
        assert!(!client.is_contract_paused(&target));
    }

    // -------------------------------------------------------------------------
    // Granular pause levels
    // -------------------------------------------------------------------------

    fn setup_registry(env: &Env) -> (Address, SecurityRegistryClient<'_>) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let registry_id = env.register(SecurityRegistry, ());
        let client = SecurityRegistryClient::new(env, &registry_id);
        client.initialize(&admin);
        (admin, client)
    }

    #[test]
    fn test_pause_flags_default_to_unpaused() {
        let env = Env::default();
        let (_, client) = setup_registry(&env);

        assert_eq!(client.get_pause_flags(), PauseState::default());
        assert!(!client.is_deposit_paused());
        assert!(!client.is_withdraw_paused());
        assert!(!client.is_swap_paused());
    }

    #[test]
    fn test_deposit_only_pause_keeps_withdrawals_open() {
        let env = Env::default();
        let (admin, client) = setup_registry(&env);

        let flags = PauseState {
            deposits_paused: true,
            withdrawals_paused: false,
            swaps_paused: false,
        };
        client.set_pause_flags(&admin, &flags);

        assert_eq!(client.get_pause_flags(), flags);
        assert!(client.is_deposit_paused());
        assert!(!client.is_withdraw_paused());
        assert!(!client.is_swap_paused());
        // Granular flags do not engage the global kill switch.
        assert!(!client.is_paused());
    }

    #[test]
    fn test_withdraw_only_pause_keeps_deposits_open() {
        let env = Env::default();
        let (admin, client) = setup_registry(&env);

        client.set_pause_flags(
            &admin,
            &PauseState {
                deposits_paused: false,
                withdrawals_paused: true,
                swaps_paused: false,
            },
        );

        assert!(!client.is_deposit_paused());
        assert!(client.is_withdraw_paused());
        assert!(!client.is_swap_paused());
    }

    #[test]
    fn test_swap_only_pause() {
        let env = Env::default();
        let (admin, client) = setup_registry(&env);

        client.set_pause_flags(
            &admin,
            &PauseState {
                deposits_paused: false,
                withdrawals_paused: false,
                swaps_paused: true,
            },
        );

        assert!(!client.is_deposit_paused());
        assert!(!client.is_withdraw_paused());
        assert!(client.is_swap_paused());
    }

    #[test]
    fn test_clearing_pause_flags_resumes_operations() {
        let env = Env::default();
        let (admin, client) = setup_registry(&env);

        client.set_pause_flags(
            &admin,
            &PauseState {
                deposits_paused: true,
                withdrawals_paused: true,
                swaps_paused: true,
            },
        );
        client.set_pause_flags(&admin, &PauseState::default());

        assert!(!client.is_deposit_paused());
        assert!(!client.is_withdraw_paused());
        assert!(!client.is_swap_paused());
    }

    #[test]
    fn test_global_pause_overrides_granular_flags() {
        let env = Env::default();
        let (admin, client) = setup_registry(&env);

        client.pause(&admin);
        assert_eq!(client.get_pause_flags(), PauseState::default());
        assert!(client.is_deposit_paused());
        assert!(client.is_withdraw_paused());
        assert!(client.is_swap_paused());

        client.unpause(&admin);
        assert!(!client.is_deposit_paused());
        assert!(!client.is_withdraw_paused());
        assert!(!client.is_swap_paused());
    }

    #[test]
    fn test_set_pause_flags_requires_admin_auth_and_extends_ttl() {
        let env = Env::default();
        let (admin, client) = setup_registry(&env);

        client.set_pause_flags(
            &admin,
            &PauseState {
                deposits_paused: true,
                withdrawals_paused: false,
                swaps_paused: false,
            },
        );

        let auths = env.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, admin);

        let ttl = env.as_contract(&client.address, || env.storage().instance().get_ttl());
        assert!(ttl >= anchorpoint_utils::storage::INSTANCE_EXTEND_TO);
    }

    #[test]
    #[should_panic(expected = "not super admin")]
    fn test_set_pause_flags_non_admin_panics() {
        let env = Env::default();
        let (_, client) = setup_registry(&env);

        let attacker = Address::generate(&env);
        client.set_pause_flags(
            &attacker,
            &PauseState {
                deposits_paused: true,
                withdrawals_paused: true,
                swaps_paused: true,
            },
        );
    }
}
