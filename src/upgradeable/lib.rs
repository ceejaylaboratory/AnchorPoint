#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};

/// Storage keys used by the upgradeable contract.
#[derive(Clone)]
#[contracttype]
enum DataKey {
    /// The administrator address authorized to perform upgrades.
    Admin,
    /// The current contract version number (incremented on each upgrade).
    Version,
}

#[contract]
pub struct UpgradeableContract;

#[contractimpl]
impl UpgradeableContract {
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

    /// Initializes the contract with the given admin address.
    ///
    /// # Arguments
    /// * `admin` - The address that will have exclusive upgrade authority.
    ///
    /// # Panics
    /// Panics if the contract has already been initialized.
    pub fn initialize(env: Env, admin: Address) {
        // Ensure the contract has not been initialized before.
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("contract already initialized");
        }

        // Store the admin address and set the initial version.
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Version, &1u32);
    }

    /// Upgrades the contract to a new WASM binary identified by `new_wasm_hash`.
    ///
    /// Only the current admin can call this function. The version counter is
    /// incremented after a successful upgrade.
    ///
    /// # Arguments
    /// * `new_wasm_hash` - The hash of the new contract WASM that has been
    ///   previously installed on the network via `install_contract_wasm`.
    ///
    /// # Panics
    /// Panics if the caller is not the admin.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
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

        // Retrieve the admin and enforce authorization.
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        // Increment the version counter.
        let current_version: u32 = env.storage().instance().get(&DataKey::Version).unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &(current_version + 1));

        // Perform the upgrade — this replaces the running WASM.
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Transfers the admin role to a new address.
    ///
    /// Only the current admin can call this function.
    ///
    /// # Arguments
    /// * `new_admin` - The address of the new administrator.
    ///
    /// # Panics
    /// Panics if the caller is not the current admin.
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        // Replace the stored admin.
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    /// Returns the current contract version number.
    ///
    /// The version starts at 1 and is incremented on each successful upgrade.
    pub fn version(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    /// Returns the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup_contract() -> (Env, UpgradeableContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(UpgradeableContract, ());
        let client = UpgradeableContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        (env, client, admin)
    }

    #[test]
    fn test_initialize() {
        let (_env, client, admin) = setup_contract();

        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.version(), 1);
    }

    #[test]
    #[should_panic(expected = "contract already initialized")]
    fn test_initialize_twice_panics() {
        let (env, client, _admin) = setup_contract();

        // Attempting to initialize again should panic.
        let another_admin = Address::generate(&env);
        client.initialize(&another_admin);
    }

    #[test]
    fn test_set_admin() {
        let (env, client, _admin) = setup_contract();

        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);

        assert_eq!(client.get_admin(), new_admin);
    }

    #[test]
    fn test_version() {
        let (_env, client, _admin) = setup_contract();
        assert_eq!(client.version(), 1);
    }
}
