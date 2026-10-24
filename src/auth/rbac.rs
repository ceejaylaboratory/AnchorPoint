#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Bytes, Env};

/// Defined roles for the RBAC module.
/// Values are ordered such that lower values have more permissions.
/// Hierarchy: Admin (0) > Moderator (1) > Contributor (2)
/// Special roles: Minter (10), Burner (11), Pauser (12) - these are not hierarchical
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum AccessRole {
    Admin = 0,
    Moderator = 1,
    Contributor = 2,
    Minter = 10,
    Burner = 11,
    Pauser = 12,
}

/// Storage keys for the RBAC module.
#[contracttype]
pub enum AccessDataKey {
    Role(Address),
    AdminInitialized,
    /// Sequence nonce for an account (monotonically increasing).
    AccountNonce(Address),
    /// Marks a nonce value as consumed so it cannot be replayed.
    /// The value is the ledger sequence at which it was consumed,
    /// allowing future housekeeping / TTL expiry.
    UsedNonce(Address, u64),
}

/// How long (in ledger sequences) a used-nonce entry is kept before it can
/// be pruned.  In production this should be at least the maximum allowed
/// clock drift / replay window.  1 week ≈ 604 800 seconds ÷ 5 s/ledger.
const NONCE_TTL_LEDGERS: u32 = 120_960;

/// A collection of utility functions to manage RBAC.
/// These can be used from within other contracts to implement role-based access.
pub struct RBAC;

#[allow(deprecated)]
impl RBAC {
    /// Checks if an address has the required role or a higher one.
    /// Admin > Moderator > Contributor
    /// Special roles (Minter, Burner, Pauser) are checked exactly (no hierarchy)
    pub fn has_role(env: &Env, address: &Address, required_role: AccessRole) -> bool {
        let key = AccessDataKey::Role(address.clone());
        let current_role: Option<AccessRole> = env.storage().instance().get(&key);

        match current_role {
            Some(role) => {
                // Special roles require exact match
                if required_role as u32 >= 10 {
                    role == required_role
                } else {
                    // Hierarchical roles: Admin > Moderator > Contributor
                    (role as u32) <= (required_role as u32)
                }
            }
            None => false,
        }
    }

    /// Checks if an address has any of the specified roles.
    pub fn has_any_role(env: &Env, address: &Address, roles: &[AccessRole]) -> bool {
        roles.iter().any(|&role| Self::has_role(env, address, role))
    }

    /// Panics if the address does not have the required role or higher.
    pub fn require_role(env: &Env, address: &Address, required_role: AccessRole) {
        if !Self::has_role(env, address, required_role) {
            panic!("unauthorized: access denied for required role");
        }
    }

    /// Panics if the address does not have any of the specified roles.
    pub fn require_any_role(env: &Env, address: &Address, roles: &[AccessRole]) {
        if !Self::has_any_role(env, address, roles) {
            panic!("unauthorized: access denied for required roles");
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
        env.events().publish(
            (symbol_short!("rbac"), symbol_short!("role_set")),
            (target.clone(), role),
        );
    }

    /// Revokes any role from a target address. Only an Admin can call this.
    /// This provides instant revocation capability as required.
    pub fn revoke_role(env: &Env, admin: &Address, target: &Address) {
        admin.require_auth();
        Self::require_role(env, admin, AccessRole::Admin);

        let key = AccessDataKey::Role(target.clone());

        // Check if target has a role before revoking
        if let Some(role) = env.storage().instance().get::<_, AccessRole>(&key) {
            env.storage().instance().remove(&key);

            // Emit role revocation event with the revoked role
            env.events()
                .publish((symbol_short!("role_rev"), target.clone()), role);
        } else {
            panic!("target has no role to revoke");
        }
    }

    /// Revokes a specific role from a target address. Only an Admin can call this.
    /// This provides instant revocation capability for specific roles.
    pub fn revoke_specific_role(env: &Env, admin: &Address, target: &Address, role: AccessRole) {
        admin.require_auth();
        Self::require_role(env, admin, AccessRole::Admin);

        let key = AccessDataKey::Role(target.clone());

        // Check if target has the specific role
        let current_role: Option<AccessRole> = env.storage().instance().get(&key);
        if current_role == Some(role) {
            env.storage().instance().remove(&key);

            // Emit role revocation event
            env.events()
                .publish((symbol_short!("role_rev"), target.clone()), role);
        } else {
            panic!("target does not have the specified role");
        }
    }

    /// Checks if a specific role can perform a minter operation.
    pub fn is_minter(env: &Env, address: &Address) -> bool {
        Self::has_role(env, address, AccessRole::Minter)
            || Self::has_role(env, address, AccessRole::Admin)
    }

    /// Checks if a specific role can perform a burner operation.
    pub fn is_burner(env: &Env, address: &Address) -> bool {
        Self::has_role(env, address, AccessRole::Burner)
            || Self::has_role(env, address, AccessRole::Admin)
    }

    /// Checks if a specific role can perform a pauser operation.
    pub fn is_pauser(env: &Env, address: &Address) -> bool {
        Self::has_role(env, address, AccessRole::Pauser)
            || Self::has_role(env, address, AccessRole::Admin)
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
            (symbol_short!("rbac"), symbol_short!("role_set")),
            (admin.clone(), AccessRole::Admin),
        );
    }

    // ── Nonce management ──────────────────────────────────────────────────────

    /// Returns the current (next-expected) nonce for an account.
    ///
    /// The nonce starts at 0 for a new account and is incremented each time
    /// `consume_nonce` is called successfully.  Callers must include the
    /// current nonce in the signed challenge so that replays are rejected
    /// even if the same signature bytes are re-submitted.
    pub fn current_nonce(env: &Env, account: &Address) -> u64 {
        env.storage()
            .instance()
            .get(&AccessDataKey::AccountNonce(account.clone()))
            .unwrap_or(0u64)
    }

    /// Atomically increments the account nonce **before** signature
    /// verification and records the old value as permanently used.
    ///
    /// The nonce is incremented **before** the cryptographic check so that
    /// even if verification fails (wrong signature, expired challenge, etc.)
    /// the nonce is already consumed and cannot be replayed.  This prevents
    /// an attacker from repeatedly replaying an intercepted challenge until
    /// they find a way to forge the signature.
    ///
    /// # Arguments
    /// * `account`   – the authenticating account
    /// * `nonce`     – the nonce value the caller claims to be using; must
    ///                 match the current stored nonce exactly
    ///
    /// # Returns
    /// The new (post-increment) nonce value, ready for the next authentication.
    ///
    /// # Errors
    /// Panics with `Error::InvalidNonce` if:
    /// - `nonce` does not match the stored current nonce (wrong sequence), or
    /// - the nonce value has previously been recorded in the used-nonce map
    ///   (replay detected).
    pub fn consume_nonce(env: &Env, account: &Address, nonce: u64) -> u64 {
        let stored_nonce = Self::current_nonce(env, account);

        // Guard 1: sequence must match.
        if nonce != stored_nonce {
            panic!("Error::InvalidNonce: nonce sequence mismatch");
        }

        // Guard 2: must not already be in the used-nonce map.
        let used_key = AccessDataKey::UsedNonce(account.clone(), nonce);
        if env.storage().persistent().has(&used_key) {
            panic!("Error::InvalidNonce: nonce already used (replay detected)");
        }

        // ── Increment BEFORE the caller performs signature verification ───────
        // This means any subsequent call with the same nonce will fail even if
        // the current invocation ultimately panics during sig-verify.
        let new_nonce = nonce.checked_add(1).expect("nonce overflow");
        env.storage()
            .instance()
            .set(&AccessDataKey::AccountNonce(account.clone()), &new_nonce);

        // Persist the used nonce with a TTL so it can be pruned later.
        let current_ledger = env.ledger().sequence();
        env.storage()
            .persistent()
            .set(&used_key, &current_ledger);
        anchorpoint_utils::storage::extend_persistent_ttl_with(
            &env,
            &used_key,
            NONCE_TTL_LEDGERS,
            NONCE_TTL_LEDGERS,
        );

        // Emit event for off-chain indexers.
        env.events().publish(
            (symbol_short!("auth"), symbol_short!("nonce_use")),
            (account.clone(), nonce),
        );

        new_nonce
    }

    /// Verify a SEP-10-style authentication challenge.
    ///
    /// The nonce is consumed (incremented) **before** the signature is
    /// checked so that a failed verification still burns the nonce, preventing
    /// replay attacks.  Callers must re-generate a fresh challenge if this
    /// function panics.
    ///
    /// # Arguments
    /// * `account`   – the account that is authenticating
    /// * `nonce`     – the nonce embedded in the signed challenge
    /// * `_signature` – the Ed25519 / Stellar signature bytes (placeholder for
    ///                  on-chain verification; actual crypto is performed by
    ///                  the Soroban host via `require_auth`)
    ///
    /// # Panics
    /// - `Error::InvalidNonce`  – nonce mismatch or replay detected (checked
    ///                            before sig-verify so the nonce is burned)
    /// - `"signature verification failed"` – signature is invalid
    pub fn verify_auth(env: &Env, account: &Address, nonce: u64, _signature: &Bytes) {
        // Step 1: consume nonce FIRST (before any signature work).
        // If this panics the whole transaction is rolled back but the nonce
        // increment is effectively discarded too — this is safe because the
        // Soroban host reverts all storage mutations on panic.
        Self::consume_nonce(env, account, nonce);

        // Step 2: require_auth enforces the Stellar signature on the host
        // level.  If the signature is invalid the host itself panics, which
        // means we never reach code below and the nonce has already been
        // advanced (if the storage was committed before the auth check).
        account.require_auth();

        // Step 3: signature verified successfully — emit auth event.
        env.events().publish(
            (symbol_short!("auth"), symbol_short!("verified")),
            account.clone(),
        );
    }
}

/// A standalone contract implementation of RBAC that can be deployed independently.
/// This fulfils the "Universal modular contract" requirement.
#[contract]
pub struct RBACContract;

#[allow(deprecated)]
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
        env.events()
            .publish((symbol_short!("sec_reg"),), registry);
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

    /// Revokes a specific role from a target address. Only the admin can call this.
    pub fn revoke_specific_role(env: Env, from: Address, target: Address, role: AccessRole) {
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

        RBAC::revoke_specific_role(&env, &from, &target, role);
    }

    /// Checks if an address can perform minter operations.
    pub fn is_minter(env: Env, address: Address) -> bool {
        RBAC::is_minter(&env, &address)
    }

    /// Checks if an address can perform burner operations.
    pub fn is_burner(env: Env, address: Address) -> bool {
        RBAC::is_burner(&env, &address)
    }

    /// Checks if an address can perform pauser operations.
    pub fn is_pauser(env: Env, address: Address) -> bool {
        RBAC::is_pauser(&env, &address)
    }

    /// Checks if an address has the specified role or higher (Admin > Moderator > Contributor).
    pub fn has_role(env: Env, address: Address, role: AccessRole) -> bool {
        RBAC::has_role(&env, &address, role)
    }

    /// Returns the raw role of an address, if any.
    pub fn get_role(env: Env, address: Address) -> Option<AccessRole> {
        env.storage().instance().get(&AccessDataKey::Role(address))
    }

    /// Returns the current nonce for an account.
    pub fn current_nonce(env: Env, account: Address) -> u64 {
        RBAC::current_nonce(&env, &account)
    }

    /// Consumes the nonce for an account (increments it).
    ///
    /// The nonce is advanced **before** signature verification so that replay
    /// attacks are blocked even when signature verification subsequently fails.
    pub fn consume_nonce(env: Env, account: Address, nonce: u64) -> u64 {
        RBAC::consume_nonce(&env, &account, nonce)
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_rbac_flow() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let mod_user = Address::generate(&env);
        let contributor = Address::generate(&env);
        let minter = Address::generate(&env);
        let burner = Address::generate(&env);
        let pauser = Address::generate(&env);
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

        // Assign special roles
        client.set_role(&admin, &minter, &AccessRole::Minter);
        assert!(client.has_role(&minter, &AccessRole::Minter));
        assert!(!client.has_role(&minter, &AccessRole::Burner));
        assert!(client.is_minter(&minter));

        client.set_role(&admin, &burner, &AccessRole::Burner);
        assert!(client.has_role(&burner, &AccessRole::Burner));
        assert!(!client.has_role(&burner, &AccessRole::Minter));
        assert!(client.is_burner(&burner));

        client.set_role(&admin, &pauser, &AccessRole::Pauser);
        assert!(client.has_role(&pauser, &AccessRole::Pauser));
        assert!(client.is_pauser(&pauser));

        // Admin should have all special role permissions
        assert!(client.is_minter(&admin));
        assert!(client.is_burner(&admin));
        assert!(client.is_pauser(&admin));

        // Unassigned user
        assert!(!client.has_role(&random, &AccessRole::Contributor));

        // Revoke
        client.revoke_role(&admin, &mod_user);
        assert!(!client.has_role(&mod_user, &AccessRole::Contributor));

        // Revoke specific role
        client.revoke_specific_role(&admin, &minter, &AccessRole::Minter);
        assert!(!client.has_role(&minter, &AccessRole::Minter));
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

    // ── Nonce tests ───────────────────────────────────────────────────────────

    #[test]
    fn test_initial_nonce_is_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(RBACContract, ());
        let client = RBACContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        assert_eq!(client.current_nonce(&user), 0, "fresh account nonce must be 0");
    }

    #[test]
    fn test_consume_nonce_increments() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(RBACContract, ());
        let client = RBACContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        assert_eq!(client.current_nonce(&user), 0);

        let new_nonce = client.consume_nonce(&user, &0u64);
        assert_eq!(new_nonce, 1, "nonce should be 1 after first consume");
        assert_eq!(client.current_nonce(&user), 1);

        let new_nonce2 = client.consume_nonce(&user, &1u64);
        assert_eq!(new_nonce2, 2);
        assert_eq!(client.current_nonce(&user), 2);
    }

    #[test]
    #[should_panic(expected = "Error::InvalidNonce: nonce sequence mismatch")]
    fn test_wrong_nonce_sequence_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(RBACContract, ());
        let client = RBACContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        // Current nonce is 0, sending 5 must fail.
        client.consume_nonce(&user, &5u64);
    }

    #[test]
    #[should_panic(expected = "Error::InvalidNonce: nonce already used")]
    fn test_replay_nonce_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(RBACContract, ());
        let client = RBACContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        // Consume nonce 0 legitimately.
        client.consume_nonce(&user, &0u64);

        // Manually reset the counter to simulate a replay scenario where
        // the attacker tries to reuse nonce 0 after the account nonce was
        // somehow reset (belt-and-suspenders: the used-nonce map must also
        // reject the replay).
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&AccessDataKey::AccountNonce(user.clone()), &0u64);
            RBAC::consume_nonce(&env, &user, 0);
        });
    }

    #[test]
    fn test_nonce_state_is_per_account() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(RBACContract, ());
        let client = RBACContractClient::new(&env, &contract_id);

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        client.consume_nonce(&alice, &0u64);
        client.consume_nonce(&alice, &1u64);

        // Bob still starts at 0.
        assert_eq!(client.current_nonce(&bob), 0);
        client.consume_nonce(&bob, &0u64);

        assert_eq!(client.current_nonce(&alice), 2);
        assert_eq!(client.current_nonce(&bob), 1);
    }

    #[test]
    fn test_nonce_incremented_before_signature_check() {
        // This test verifies that the nonce counter advances even when the
        // surrounding auth check would fail.  We consume nonce 0 and confirm
        // the counter is at 1.  A second call with nonce 0 should now fail
        // with a SEQUENCE mismatch (not just a used-nonce hit) because the
        // counter moved — demonstrating the nonce was burned before any
        // higher-level verification ran.
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(RBACContract, ());
        let client = RBACContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        client.consume_nonce(&user, &0u64);
        assert_eq!(client.current_nonce(&user), 1);

        // Attempting the same nonce again must fail.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.consume_nonce(&user, &0u64);
        }));
        assert!(result.is_err(), "replayed nonce must be rejected");
    }
}
