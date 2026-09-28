#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    SuperAdmin,
    /// Address nominated via `propose_admin`, awaiting `accept_admin`.
    PendingAdmin,
    IsPaused,
    /// Pause status per individual registered contract
    ContractPaused(Address),
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

    // -------------------------------------------------------------------------
    // Two-step admin transfer
    // -------------------------------------------------------------------------

    /// Nominate a new super admin (current super admin only).
    ///
    /// Ownership does not move until `proposed_admin` calls `accept_admin`,
    /// so a typo or unreachable address cannot brick the registry. Proposing
    /// again replaces any outstanding nomination.
    pub fn propose_admin(env: Env, current_admin: Address, proposed_admin: Address) {
        current_admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if current_admin != stored_admin {
            panic!("not super admin");
        }
        if proposed_admin == stored_admin {
            panic!("proposed admin is already super admin");
        }
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &proposed_admin);

        anchorpoint_utils::storage::extend_instance_ttl(
            &env,
            anchorpoint_utils::storage::INSTANCE_THRESHOLD,
            anchorpoint_utils::storage::INSTANCE_EXTEND_TO,
        );
    }

    /// Accept a pending nomination, completing the admin transfer.
    ///
    /// Must be authorized by the nominated address itself.
    pub fn accept_admin(env: Env, proposed_admin: Address) {
        proposed_admin.require_auth();
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .expect("no pending admin");
        if proposed_admin != pending {
            panic!("not pending admin");
        }
        env.storage()
            .instance()
            .set(&DataKey::SuperAdmin, &proposed_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        anchorpoint_utils::storage::extend_instance_ttl(
            &env,
            anchorpoint_utils::storage::INSTANCE_THRESHOLD,
            anchorpoint_utils::storage::INSTANCE_EXTEND_TO,
        );
    }

    /// Withdraw an outstanding nomination (current super admin only).
    pub fn cancel_admin_proposal(env: Env, current_admin: Address) {
        current_admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized");
        if current_admin != stored_admin {
            panic!("not super admin");
        }
        if !env.storage().instance().has(&DataKey::PendingAdmin) {
            panic!("no pending admin");
        }
        env.storage().instance().remove(&DataKey::PendingAdmin);
    }

    /// Returns the current super admin.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized")
    }

    /// Returns the nominated admin awaiting acceptance, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
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

    // -------------------------------------------------------------------------
    // Two-step admin transfer
    // -------------------------------------------------------------------------

    fn setup_admin_transfer(env: &Env) -> (Address, SecurityRegistryClient<'_>) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let registry_id = env.register(SecurityRegistry, ());
        let client = SecurityRegistryClient::new(env, &registry_id);
        client.initialize(&admin);
        (admin, client)
    }

    #[test]
    fn test_two_step_admin_transfer() {
        let env = Env::default();
        let (admin, client) = setup_admin_transfer(&env);
        let new_admin = Address::generate(&env);

        client.propose_admin(&admin, &new_admin);
        assert_eq!(env.auths()[0].0, admin);
        assert_eq!(client.get_pending_admin(), Some(new_admin.clone()));
        // Admin storage is untouched until the nominee accepts.
        assert_eq!(client.get_admin(), admin);

        client.accept_admin(&new_admin);
        assert_eq!(env.auths()[0].0, new_admin);
        assert_eq!(client.get_admin(), new_admin);
        assert_eq!(client.get_pending_admin(), None);

        // The new admin holds privileges; the old admin no longer does.
        client.pause(&new_admin);
        assert!(client.is_paused());
    }

    #[test]
    #[should_panic(expected = "not super admin")]
    fn test_old_admin_loses_privileges_after_transfer() {
        let env = Env::default();
        let (admin, client) = setup_admin_transfer(&env);
        let new_admin = Address::generate(&env);

        client.propose_admin(&admin, &new_admin);
        client.accept_admin(&new_admin);
        client.pause(&admin);
    }

    #[test]
    #[should_panic(expected = "not super admin")]
    fn test_propose_admin_by_non_admin_panics() {
        let env = Env::default();
        let (_, client) = setup_admin_transfer(&env);
        let attacker = Address::generate(&env);

        client.propose_admin(&attacker, &attacker);
    }

    #[test]
    #[should_panic(expected = "proposed admin is already super admin")]
    fn test_propose_current_admin_panics() {
        let env = Env::default();
        let (admin, client) = setup_admin_transfer(&env);

        client.propose_admin(&admin, &admin);
    }

    #[test]
    #[should_panic(expected = "not pending admin")]
    fn test_accept_admin_by_wrong_address_panics() {
        let env = Env::default();
        let (admin, client) = setup_admin_transfer(&env);

        client.propose_admin(&admin, &Address::generate(&env));
        client.accept_admin(&Address::generate(&env));
    }

    #[test]
    #[should_panic(expected = "no pending admin")]
    fn test_accept_admin_without_proposal_panics() {
        let env = Env::default();
        let (_, client) = setup_admin_transfer(&env);

        client.accept_admin(&Address::generate(&env));
    }

    #[test]
    fn test_new_proposal_replaces_previous_nominee() {
        let env = Env::default();
        let (admin, client) = setup_admin_transfer(&env);
        let wrong = Address::generate(&env);
        let right = Address::generate(&env);

        client.propose_admin(&admin, &wrong);
        client.propose_admin(&admin, &right);
        assert_eq!(client.get_pending_admin(), Some(right.clone()));

        client.accept_admin(&right);
        assert_eq!(client.get_admin(), right);
    }

    #[test]
    #[should_panic(expected = "not pending admin")]
    fn test_replaced_nominee_cannot_accept() {
        let env = Env::default();
        let (admin, client) = setup_admin_transfer(&env);
        let wrong = Address::generate(&env);

        client.propose_admin(&admin, &wrong);
        client.propose_admin(&admin, &Address::generate(&env));
        client.accept_admin(&wrong);
    }

    #[test]
    fn test_cancel_admin_proposal() {
        let env = Env::default();
        let (admin, client) = setup_admin_transfer(&env);
        let nominee = Address::generate(&env);

        client.propose_admin(&admin, &nominee);
        client.cancel_admin_proposal(&admin);

        assert_eq!(client.get_pending_admin(), None);
        assert_eq!(client.get_admin(), admin);
        assert!(client.try_accept_admin(&nominee).is_err());
    }

    #[test]
    #[should_panic(expected = "no pending admin")]
    fn test_cancel_without_proposal_panics() {
        let env = Env::default();
        let (admin, client) = setup_admin_transfer(&env);

        client.cancel_admin_proposal(&admin);
    }

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
}
