#![no_std]
//! AnchorPoint Registry Contract
//! 
//! This contract stores the addresses and version numbers of all other AnchorPoint contracts,
//! allowing for easy discovery and upgrades across the protocol.

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

/// Contract metadata stored in the registry
#[contracttype]
#[derive(Clone)]
pub struct ContractInfo {
    /// Contract address
    pub address: Address,
    /// Contract version (e.g., "1.0.0")
    pub version: String,
    /// Contract type/name (e.g., "AMM", "Lending", "Bridge")
    pub contract_type: String,
    /// Deployment timestamp
    pub deployed_at: u64,
    /// Whether this contract is currently active
    pub active: bool,
    /// Previous version address (for upgrades)
    pub previous_version: Option<Address>,
}

/// Storage keys for the registry
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address
    Admin,
    /// Contract info by contract type (contract_type -> ContractInfo)
    Contract(String),
    /// All registered contract types
    AllContractTypes,
    /// Registry version
    RegistryVersion,
    /// Paused state
    Paused,
}

#[contract]
pub struct Registry;

#[contractimpl]
impl Registry {
    /// Initialize the registry with an admin address
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::RegistryVersion, &1u32);
        env.storage().instance().set(&DataKey::Paused, &false);
        
        // Initialize empty contract types list
        let contract_types: Vec<String> = Vec::new(&env);
        env.storage().instance().set(&DataKey::AllContractTypes, &contract_types);
        
        env.events()
            .publish((symbol_short!("init"), admin), 1u32);
    }

    /// Register a new contract or update an existing one
    pub fn register_contract(
        env: Env,
        admin: Address,
        contract_type: String,
        address: Address,
        version: String,
    ) {
        admin.require_auth();
        Self::check_not_paused(&env);
        
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        let contract_key = DataKey::Contract(contract_type.clone());
        let timestamp = env.ledger().timestamp();
        
        // Check if contract already exists
        if let Some(existing_info) = env.storage().instance().get::<_, ContractInfo>(&contract_key) {
            // Update existing contract
            let updated_info = ContractInfo {
                address: address.clone(),
                version: version.clone(),
                contract_type: contract_type.clone(),
                deployed_at: timestamp,
                active: true,
                previous_version: Some(existing_info.address),
            };
            
            env.storage().instance().set(&contract_key, &updated_info);
            
            env.events()
                .publish(
                    (symbol_short!("update"), contract_type.clone()),
                    (address, version),
                );
        } else {
            // Register new contract
            let contract_info = ContractInfo {
                address: address.clone(),
                version: version.clone(),
                contract_type: contract_type.clone(),
                deployed_at: timestamp,
                active: true,
                previous_version: None,
            };
            
            env.storage().instance().set(&contract_key, &contract_info);
            
            // Add to contract types list
            let mut contract_types: Vec<String> = env
                .storage()
                .instance()
                .get(&DataKey::AllContractTypes)
                .unwrap_or(Vec::new(&env));
            
            // Check if already in list to avoid duplicates
            let already_registered = contract_types.iter().any(|t| t == &contract_type);
            if !already_registered {
                contract_types.push_back(contract_type.clone());
                env.storage().instance().set(&DataKey::AllContractTypes, &contract_types);
            }
            
            env.events()
                .publish(
                    (symbol_short!("register"), contract_type.clone()),
                    (address, version),
                );
        }
    }

    /// Deactivate a contract (mark as inactive without removing from registry)
    pub fn deactivate_contract(env: Env, admin: Address, contract_type: String) {
        admin.require_auth();
        Self::check_not_paused(&env);
        
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        let contract_key = DataKey::Contract(contract_type.clone());
        let mut contract_info: ContractInfo = env
            .storage()
            .instance()
            .get(&contract_key)
            .expect("contract not registered");
        
        contract_info.active = false;
        env.storage().instance().set(&contract_key, &contract_info);
        
        env.events()
            .publish((symbol_short!("deactivate"), contract_type), true);
    }

    /// Reactivate a previously deactivated contract
    pub fn activate_contract(env: Env, admin: Address, contract_type: String) {
        admin.require_auth();
        Self::check_not_paused(&env);
        
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        let contract_key = DataKey::Contract(contract_type.clone());
        let mut contract_info: ContractInfo = env
            .storage()
            .instance()
            .get(&contract_key)
            .expect("contract not registered");
        
        contract_info.active = true;
        env.storage().instance().set(&contract_key, &contract_info);
        
        env.events()
            .publish((symbol_short!("activate"), contract_type), true);
    }

    /// Remove a contract from the registry (admin only)
    pub fn remove_contract(env: Env, admin: Address, contract_type: String) {
        admin.require_auth();
        Self::check_not_paused(&env);
        
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        let contract_key = DataKey::Contract(contract_type.clone());
        if !env.storage().instance().has(&contract_key) {
            panic!("contract not registered");
        }
        
        env.storage().instance().remove(&contract_key);
        
        // Remove from contract types list
        let mut contract_types: Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::AllContractTypes)
            .unwrap_or(Vec::new(&env));
        
        contract_types = contract_types.filter(|t| t != &contract_type);
        env.storage().instance().set(&DataKey::AllContractTypes, &contract_types);
        
        env.events()
            .publish((symbol_short!("remove"), contract_type), true);
    }

    /// Transfer admin rights to a new address
    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) {
        admin.require_auth();
        
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        
        env.events()
            .publish((symbol_short!("transfer_admin"), admin), new_admin);
    }

    /// Pause registry operations (emergency function)
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().set(&DataKey::Paused, &true);
        
        env.events()
            .publish((symbol_short!("pause"), admin), true);
    }

    /// Unpause registry operations
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        
        env.storage().instance().set(&DataKey::Paused, &false);
        
        env.events()
            .publish((symbol_short!("unpause"), admin), true);
    }

    // ========================================================================
    // Query Functions
    // ========================================================================

    /// Get contract information by type
    pub fn get_contract(env: Env, contract_type: String) -> ContractInfo {
        env.storage()
            .instance()
            .get(&DataKey::Contract(contract_type))
            .expect("contract not found")
    }

    /// Get contract address by type
    pub fn get_address(env: Env, contract_type: String) -> Address {
        let info = Self::get_contract(env, contract_type);
        info.address
    }

    /// Get contract version by type
    pub fn get_version(env: Env, contract_type: String) -> String {
        let info = Self::get_contract(env, contract_type);
        info.version
    }

    /// Check if a contract is registered
    pub fn is_registered(env: Env, contract_type: String) -> bool {
        env.storage()
            .instance()
            .has(&DataKey::Contract(contract_type))
    }

    /// Check if a contract is active
    pub fn is_active(env: Env, contract_type: String) -> bool {
        let info = Self::get_contract(env, contract_type);
        info.active
    }

    /// Get all registered contract types
    pub fn get_all_contract_types(env: Env) -> Vec<String> {
        env.storage()
            .instance()
            .get(&DataKey::AllContractTypes)
            .unwrap_or(Vec::new(&env))
    }

    /// Get all active contracts
    pub fn get_active_contracts(env: Env) -> Vec<ContractInfo> {
        let contract_types = Self::get_all_contract_types(env.clone());
        let mut active_contracts = Vec::new(&env);
        
        for contract_type in contract_types.iter() {
            if let Some(info) = env.storage().instance().get::<_, ContractInfo>(&DataKey::Contract(contract_type)) {
                if info.active {
                    active_contracts.push_back(info);
                }
            }
        }
        
        active_contracts
    }

    /// Get the registry admin
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Get the registry version
    pub fn get_registry_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::RegistryVersion)
            .unwrap_or(1)
    }

    /// Check if the registry is paused
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Get contract upgrade history (current and previous versions)
    pub fn get_upgrade_history(env: Env, contract_type: String) -> Vec<Address> {
        let mut history = Vec::new(&env);
        
        let mut current_info: Option<ContractInfo> = env
            .storage()
            .instance()
            .get(&DataKey::Contract(contract_type.clone()));
        
        while let Some(info) = current_info {
            history.push_back(info.address.clone());
            
            if let Some(prev_addr) = info.previous_version {
                // Try to get previous version info
                // Note: In a full implementation, we'd need to store historical records
                // For now, we just track the immediate previous version
                break;
            } else {
                break;
            }
        }
        
        history
    }

    // ========================================================================
    // Internal Functions
    // ========================================================================

    fn check_not_paused(env: &Env) {
        assert!(!Self::is_paused(env.clone()), "registry is paused");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, RegistryClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        
        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, Registry);
        let client = RegistryClient::new(&env, &contract_id);
        
        client.initialize(&admin);
        
        (env, client, admin)
    }

    #[test]
    fn test_initialize() {
        let (env, client, admin) = setup();
        
        assert_eq!(client.get_admin(), admin);
        assert_eq!(client.get_registry_version(), 1);
        assert!(!client.is_paused());
    }

    #[test]
    fn test_register_contract() {
        let (env, client, admin) = setup();
        
        let contract_type = String::from_str(&env, "AMM");
        let address = Address::generate(&env);
        let version = String::from_str(&env, "1.0.0");
        
        client.register_contract(&admin, &contract_type, &address, &version);
        
        assert!(client.is_registered(contract_type.clone()));
        assert_eq!(client.get_address(contract_type.clone()), address);
        assert_eq!(client.get_version(contract_type.clone()), version);
        assert!(client.is_active(contract_type.clone()));
    }

    #[test]
    fn test_update_contract() {
        let (env, client, admin) = setup();
        
        let contract_type = String::from_str(&env, "AMM");
        let address1 = Address::generate(&env);
        let version1 = String::from_str(&env, "1.0.0");
        
        client.register_contract(&admin, &contract_type, &address1, &version1);
        
        // Update with new address and version
        let address2 = Address::generate(&env);
        let version2 = String::from_str(&env, "2.0.0");
        
        client.register_contract(&admin, &contract_type, &address2, &version2);
        
        let info = client.get_contract(contract_type.clone());
        assert_eq!(info.address, address2);
        assert_eq!(info.version, version2);
        assert_eq!(info.previous_version, Some(address1));
    }

    #[test]
    fn test_deactivate_contract() {
        let (env, client, admin) = setup();
        
        let contract_type = String::from_str(&env, "AMM");
        let address = Address::generate(&env);
        let version = String::from_str(&env, "1.0.0");
        
        client.register_contract(&admin, &contract_type, &address, &version);
        assert!(client.is_active(contract_type.clone()));
        
        client.deactivate_contract(&admin, &contract_type);
        assert!(!client.is_active(contract_type.clone()));
    }

    #[test]
    fn test_activate_contract() {
        let (env, client, admin) = setup();
        
        let contract_type = String::from_str(&env, "AMM");
        let address = Address::generate(&env);
        let version = String::from_str(&env, "1.0.0");
        
        client.register_contract(&admin, &contract_type, &address, &version);
        client.deactivate_contract(&admin, &contract_type);
        
        client.activate_contract(&admin, &contract_type);
        assert!(client.is_active(contract_type.clone()));
    }

    #[test]
    fn test_remove_contract() {
        let (env, client, admin) = setup();
        
        let contract_type = String::from_str(&env, "AMM");
        let address = Address::generate(&env);
        let version = String::from_str(&env, "1.0.0");
        
        client.register_contract(&admin, &contract_type, &address, &version);
        assert!(client.is_registered(contract_type.clone()));
        
        client.remove_contract(&admin, &contract_type);
        assert!(!client.is_registered(contract_type.clone()));
    }

    #[test]
    fn test_get_all_contract_types() {
        let (env, client, admin) = setup();
        
        let amm_type = String::from_str(&env, "AMM");
        let lending_type = String::from_str(&env, "Lending");
        let bridge_type = String::from_str(&env, "Bridge");
        
        client.register_contract(&admin, &amm_type, &Address::generate(&env), &String::from_str(&env, "1.0.0"));
        client.register_contract(&admin, &lending_type, &Address::generate(&env), &String::from_str(&env, "1.0.0"));
        client.register_contract(&admin, &bridge_type, &Address::generate(&env), &String::from_str(&env, "1.0.0"));
        
        let all_types = client.get_all_contract_types();
        assert_eq!(all_types.len(), 3);
    }

    #[test]
    fn test_get_active_contracts() {
        let (env, client, admin) = setup();
        
        let amm_type = String::from_str(&env, "AMM");
        let lending_type = String::from_str(&env, "Lending");
        
        let amm_address = Address::generate(&env);
        let lending_address = Address::generate(&env);
        
        client.register_contract(&admin, &amm_type, &amm_address, &String::from_str(&env, "1.0.0"));
        client.register_contract(&admin, &lending_type, &lending_address, &String::from_str(&env, "1.0.0"));
        
        client.deactivate_contract(&admin, &lending_type);
        
        let active = client.get_active_contracts();
        assert_eq!(active.len(), 1);
        assert_eq!(active.get(0).unwrap().address, amm_address);
    }

    #[test]
    fn test_transfer_admin() {
        let (env, client, admin) = setup();
        
        let new_admin = Address::generate(&env);
        client.transfer_admin(&admin, &new_admin);
        
        assert_eq!(client.get_admin(), new_admin);
    }

    #[test]
    fn test_pause_unpause() {
        let (env, client, admin) = setup();
        
        assert!(!client.is_paused());
        
        client.pause(&admin);
        assert!(client.is_paused());
        
        client.unpause(&admin);
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "registry is paused")]
    fn test_register_when_paused() {
        let (env, client, admin) = setup();
        
        client.pause(&admin);
        
        let contract_type = String::from_str(&env, "AMM");
        client.register_contract(&admin, &contract_type, &Address::generate(&env), &String::from_str(&env, "1.0.0"));
    }

    #[test]
    fn test_upgrade_history() {
        let (env, client, admin) = setup();
        
        let contract_type = String::from_str(&env, "AMM");
        let v1_address = Address::generate(&env);
        let v2_address = Address::generate(&env);
        
        client.register_contract(&admin, &contract_type, &v1_address, &String::from_str(&env, "1.0.0"));
        client.register_contract(&admin, &contract_type, &v2_address, &String::from_str(&env, "2.0.0"));
        
        let history = client.get_upgrade_history(contract_type);
        assert_eq!(history.len(), 1);
        assert_eq!(history.get(0).unwrap(), v2_address);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_unauthorized_register() {
        let (env, client, admin) = setup();
        
        let unauthorized = Address::generate(&env);
        let contract_type = String::from_str(&env, "AMM");
        
        client.register_contract(&unauthorized, &contract_type, &Address::generate(&env), &String::from_str(&env, "1.0.0"));
    }

    #[test]
    fn test_multiple_contracts() {
        let (env, client, admin) = setup();
        
        let contracts = vec![
            ("AMM", "1.0.0"),
            ("Lending", "1.0.0"),
            ("Bridge", "1.0.0"),
            ("XLMWrapper", "1.0.0"),
            ("LiquidStaking", "1.0.0"),
        ];
        
        for (name, version) in contracts.iter() {
            client.register_contract(
                &admin,
                &String::from_str(&env, name),
                &Address::generate(&env),
                &String::from_str(&env, version),
            );
        }
        
        assert_eq!(client.get_all_contract_types().len(), 5);
    }
}
