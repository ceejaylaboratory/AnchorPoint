#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

/// Defined roles for the RBAC module.
/// Values are ordered such that lower values have more permissions.
/// Hierarchy: Admin (0) > Moderator (1) > Contributor (2)
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum AccessRole {
    Admin = 0,
    Moderator = 1,
    Contributor = 2,
}

/// Storage keys for the RBAC module.
#[contracttype]
pub enum AccessDataKey {
    Role(Address),
    AdminInitialized,
}

/// A collection of utility functions to manage RBAC.
/// These can be used from within other contracts to implement role-based access.
pub struct RBAC;

impl RBAC {
    /// Checks if an address has the required role or a higher one.
    /// Admin > Moderator > Contributor
    pub fn has_role(env: &Env, address: &Address, required_role: AccessRole) -> bool {
        let key = AccessDataKey::Role(address.clone());
        let current_role: Option<AccessRole> = env.storage().instance().get(&key);

        match current_role {
            Some(role) => (role as u32) <= (required_role as u32),
            None => false,
        }
    }

    /// Panics if the address does not have the required role or higher.
    pub fn require_role(env: &Env, address: &Address, required_role: AccessRole) {
        if !Self::has_role(env, address, required_role) {
            panic!("unauthorized: access denied for required role");
        }
    }

    /// Sets the role of a target address. Only a verified Admin can call this.
    /// This function performs its own admin authorization check using `admin.require_auth()`.
    pub fn set_role(env: &Env, admin: &Address, target: &Address, role: AccessRole) {
        admin.require_auth();
        Self::require_role(env, admin, AccessRole::Admin);

        let key = AccessDataKey::Role(target.clone());
        env.storage().instance().set(&key, &role);

        // Emit role change event — topic: event name only; target + role in data.
        env.events()
            .publish(symbol_short!("role_set"), (target.clone(), role));
    }

    /// Revokes any role from a target address. Only an Admin can call this.
    pub fn revoke_role(env: &Env, admin: &Address, target: &Address) {
        admin.require_auth();
        Self::require_role(env, admin, AccessRole::Admin);

        let key = AccessDataKey::Role(target.clone());
        env.storage().instance().remove(&key);

        // Emit role revocation event — topic: event name only; target in data.
        env.events()
            .publish(symbol_short!("role_rev"), target.clone());
    }

    /// Inits the first admin. This can only be called once.
    pub fn init_admin(env: &Env, admin: &Address) {
        if env
            .storage()
            .instance()
            .has(&AccessDataKey::AdminInitialized)
        {
            panic!("rbac: admin already initialized");
        }

        env.storage()
            .instance()
            .set(&AccessDataKey::Role(admin.clone()), &AccessRole::Admin);
        env.storage()
            .instance()
            .set(&AccessDataKey::AdminInitialized, &true);

        env.events().publish(
            symbol_short!("role_set"),
            (admin.clone(), AccessRole::Admin),
        );
    }
}

/// A standalone contract implementation of RBAC that can be deployed independently.
/// This fulfills the "Universal modular contract" requirement.
#[contract]
pub struct RBACContract;

#[contractimpl]
impl RBACContract {
    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env
            .storage()
            .instance()
            .has(&soroban_sdk::symbol_short!("sec_reg"))
        {
            panic!("already set");
        }
        env.storage()
            .instance()
            .set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    /// Initializes the RBAC contract with an initial administrator.
    pub fn initialize(env: Env, admin: Address) {
        RBAC::init_admin(&env, &admin);
    }

    /// Assigns a role to a target address. Only the admin can call this.
    pub fn set_role(env: Env, from: Address, target: Address, role: AccessRole) {
        RBAC::set_role(&env, &from, &target, role);
    }

    /// Revokes any role from a target address. Only the admin can call this.
    pub fn revoke_role(env: Env, from: Address, target: Address) {
        if let Some(registry) = env
            .storage()
            .instance()
            .get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg"))
        {
            let is_paused: bool = env.invoke_contract(
                &registry,
                &soroban_sdk::Symbol::new(&env, "is_paused"),
                soroban_sdk::vec![&env],
            );
            if is_paused {
                panic!("contract is paused");
            }
        }

        RBAC::revoke_role(&env, &from, &target);
    }

    /// Checks if an address has the specified role or higher (Admin > Moderator > Contributor).
    pub fn has_role(env: Env, address: Address, role: AccessRole) -> bool {
        RBAC::has_role(&env, &address, role)
    }

    /// Returns the raw role of an address, if any.
    pub fn get_role(env: Env, address: Address) -> Option<AccessRole> {
        env.storage().instance().get(&AccessDataKey::Role(address))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_rbac_flow() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let mod_user = Address::generate(&env);
        let contributor = Address::generate(&env);
        let random = Address::generate(&env);

        let contract_id = env.register(RBACContract, ());
        let client = RBACContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        // Verify initial admin
        assert!(client.has_role(&admin, &AccessRole::Admin));
        assert!(client.has_role(&admin, &AccessRole::Moderator));
        assert!(client.has_role(&admin, &AccessRole::Contributor));

        // Use mock auth for administrative actions
        env.mock_all_auths();

        // Assign Moderator
        client.set_role(&admin, &mod_user, &AccessRole::Moderator);
        assert!(!client.has_role(&mod_user, &AccessRole::Admin));
        assert!(client.has_role(&mod_user, &AccessRole::Moderator));
        assert!(client.has_role(&mod_user, &AccessRole::Contributor));

        // Assign Contributor
        client.set_role(&admin, &contributor, &AccessRole::Contributor);
        assert!(!client.has_role(&contributor, &AccessRole::Admin));
        assert!(!client.has_role(&contributor, &AccessRole::Moderator));
        assert!(client.has_role(&contributor, &AccessRole::Contributor));

        // Unassigned user
        assert!(!client.has_role(&random, &AccessRole::Contributor));

        // Revoke
        client.revoke_role(&admin, &mod_user);
        assert!(!client.has_role(&mod_user, &AccessRole::Contributor));
    }

    #[test]
    #[should_panic(expected = "rbac: admin already initialized")]
    fn test_double_initialization() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(RBACContract, ());
        let client = RBACContractClient::new(&env, &contract_id);

        client.initialize(&admin);
        client.initialize(&admin);
    }
}
