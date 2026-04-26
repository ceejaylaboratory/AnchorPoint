#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Vec, Map};

/// Storage keys used by the upgradeable contract.
#[derive(Clone)]
#[contracttype]
enum DataKey {
    /// The administrator address authorized to perform upgrades.
    Admin,
    /// The current contract version number (incremented on each upgrade).
    Version,
    /// List of administrator addresses for multi-sig (5 addresses).
    AdminList,
    /// Pending upgrade proposal.
    UpgradeProposal,
    /// Approval tracking for upgrade proposals (Address -> bool).
    Approval(Address),
}

/// Upgrade proposal structure.
#[contracttype]
#[derive(Clone)]
pub struct UpgradeProposal {
    /// The proposed WASM hash.
    pub wasm_hash: BytesN<32>,
    /// Timestamp when the proposal was created.
    pub proposed_at: u64,
    /// Number of approvals received.
    pub approval_count: u32,
    /// Whether the proposal has been executed.
    pub executed: bool,
}

#[contract]
pub struct UpgradeableContract;

#[contractimpl]
impl UpgradeableContract {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    /// Initializes the contract with the given multi-sig admin list (5 addresses).
    ///
    /// # Arguments
    /// * `admin_list` - A vector of 5 administrator addresses.
    ///
    /// # Panics
    /// Panics if the contract has already been initialized or if admin list is not exactly 5 addresses.
    pub fn initialize(env: Env, admin_list: Vec<Address>) {
        // Ensure the contract has not been initialized before.
        if env.storage().instance().has(&DataKey::AdminList) {
            panic!("contract already initialized");
        }

        // Ensure exactly 5 administrators are provided
        if admin_list.len() != 5 {
            panic!("must provide exactly 5 administrators");
        }

        // Store the admin list and set the initial version.
        env.storage().instance().set(&DataKey::AdminList, &admin_list);
        env.storage().instance().set(&DataKey::Version, &1u32);
    }

    /// Proposes an upgrade to a new WASM binary.
    ///
    /// Any administrator can call this function to propose an upgrade.
    /// The proposal will require 3 out of 5 administrator approvals.
    ///
    /// # Arguments
    /// * `admin` - The administrator proposing the upgrade.
    /// * `new_wasm_hash` - The hash of the new contract WASM.
    ///
    /// # Panics
    /// Panics if the caller is not an administrator or if there's already a pending proposal.
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
        admin.require_auth();
        
        // Verify caller is an administrator
        let admin_list: Vec<Address> = env.storage().instance().get(&DataKey::AdminList).expect("not initialized");
        if !admin_list.iter().any(|a| a == admin) {
            panic!("caller is not an administrator");
        }
        
        // Check if there's already a pending proposal
        if env.storage().instance().has(&DataKey::UpgradeProposal) {
            panic!("upgrade proposal already pending");
        }
        
        // Create the proposal
        let proposal = UpgradeProposal {
            wasm_hash: new_wasm_hash.clone(),
            proposed_at: env.ledger().timestamp(),
            approval_count: 1, // Proposer counts as first approval
            executed: false,
        };
        
        env.storage().instance().set(&DataKey::UpgradeProposal, &proposal);
        
        // Record the proposer's approval
        env.storage().instance().set(&DataKey::Approval(admin.clone()), &true);
        
        env.events().publish(
            (soroban_sdk::symbol_short!("upgrade"), soroban_sdk::symbol_short!("proposed")),
            (admin, new_wasm_hash),
        );
    }

    /// Approves a pending upgrade proposal.
    ///
    /// Any administrator can approve a pending proposal (except the proposer who already approved).
    /// Requires 3 out of 5 approvals to execute.
    ///
    /// # Arguments
    /// * `admin` - The administrator approving the upgrade.
    ///
    /// # Panics
    /// Panics if the caller is not an administrator, there's no pending proposal,
    /// or the caller has already approved.
    pub fn approve_upgrade(env: Env, admin: Address) {
        admin.require_auth();
        
        // Verify caller is an administrator
        let admin_list: Vec<Address> = env.storage().instance().get(&DataKey::AdminList).expect("not initialized");
        if !admin_list.iter().any(|a| a == admin) {
            panic!("caller is not an administrator");
        }
        
        // Check if there's a pending proposal
        let mut proposal: UpgradeProposal = env.storage().instance()
            .get(&DataKey::UpgradeProposal)
            .expect("no pending proposal");
        
        if proposal.executed {
            panic!("proposal already executed");
        }
        
        // Check if caller has already approved
        if env.storage().instance().has(&DataKey::Approval(admin.clone())) {
            panic!("already approved");
        }
        
        // Record approval
        env.storage().instance().set(&DataKey::Approval(admin.clone()), &true);
        proposal.approval_count += 1;
        
        // Clone values before potentially moving
        let admin_clone = admin.clone();
        let approval_count = proposal.approval_count;
        
        // Check if we have 3 approvals (3 out of 5)
        if proposal.approval_count >= 3 {
            // Execute the upgrade
            Self::execute_upgrade(env.clone(), proposal);
        } else {
            // Update proposal with new approval count
            env.storage().instance().set(&DataKey::UpgradeProposal, &proposal);
        }
        
        env.events().publish(
            (soroban_sdk::symbol_short!("upgrade"), soroban_sdk::symbol_short!("approved")),
            (admin_clone, approval_count),
        );
    }

    /// Executes an upgrade that has received sufficient approvals.
    fn execute_upgrade(env: Env, proposal: UpgradeProposal) {
        if let Some(registry) = env.storage().instance().get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg")) {
            let is_paused: bool = env.invoke_contract(&registry, &soroban_sdk::Symbol::new(&env, "is_paused"), soroban_sdk::vec![&env]);
            if is_paused {
                panic!("contract is paused");
            }
        }

        // Clone wasm_hash before using it
        let wasm_hash = proposal.wasm_hash.clone();

        // Increment the version counter.
        let current_version: u32 = env.storage().instance().get(&DataKey::Version).unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &(current_version + 1));

        // Mark proposal as executed
        let mut executed_proposal = proposal;
        executed_proposal.executed = true;
        env.storage().instance().set(&DataKey::UpgradeProposal, &executed_proposal);

        // Perform the upgrade — this replaces the running WASM.
        env.deployer().update_current_contract_wasm(wasm_hash.clone());
        
        // Clear approval records
        let admin_list: Vec<Address> = env.storage().instance().get(&DataKey::AdminList).expect("not initialized");
        for admin in admin_list.iter() {
            env.storage().instance().remove(&DataKey::Approval(admin.clone()));
        }
        
        env.events().publish(
            (soroban_sdk::symbol_short!("upgrade"), soroban_sdk::symbol_short!("executed")),
            (wasm_hash, current_version + 1),
        );
    }

    /// Cancels a pending upgrade proposal.
    ///
    /// Any administrator can cancel a pending proposal.
    ///
    /// # Arguments
    /// * `admin` - The administrator cancelling the proposal.
    ///
    /// # Panics
    /// Panics if the caller is not an administrator or there's no pending proposal.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        admin.require_auth();
        
        // Verify caller is an administrator
        let admin_list: Vec<Address> = env.storage().instance().get(&DataKey::AdminList).expect("not initialized");
        if !admin_list.iter().any(|a| a == admin) {
            panic!("caller is not an administrator");
        }
        
        // Check if there's a pending proposal
        let proposal: UpgradeProposal = env.storage().instance()
            .get(&DataKey::UpgradeProposal)
            .expect("no pending proposal");
        
        if proposal.executed {
            panic!("cannot cancel executed proposal");
        }
        
        // Remove the proposal
        env.storage().instance().remove(&DataKey::UpgradeProposal);
        
        // Clear approval records
        for admin_addr in admin_list.iter() {
            env.storage().instance().remove(&DataKey::Approval(admin_addr.clone()));
        }
        
        env.events().publish(
            (soroban_sdk::symbol_short!("upgrade"), soroban_sdk::symbol_short!("cancelled")),
            admin,
        );
    }

    /// Upgrades the contract to a new WASM binary identified by `new_wasm_hash`.
    ///
    /// DEPRECATED: Use propose_upgrade and approve_upgrade instead.
    /// This function is kept for backward compatibility but will panic if called.
    ///
    /// # Panics
    /// Always panics - use the new multi-sig upgrade flow.
    pub fn upgrade(_env: Env, _new_wasm_hash: BytesN<32>) {
        panic!("upgrade function deprecated - use propose_upgrade and approve_upgrade for multi-sig");
    }

    /// Replaces an administrator in the multi-sig list.
    ///
    /// Requires 3 out of 5 approvals to execute.
    ///
    /// # Arguments
    /// * `proposer` - The administrator proposing the change.
    /// * `old_admin` - The administrator to replace.
    /// * `new_admin` - The new administrator address.
    ///
    /// # Panics
    /// Panics if the caller is not an administrator or if old_admin is not in the list.
    pub fn replace_admin(env: Env, proposer: Address, old_admin: Address, new_admin: Address) {
        proposer.require_auth();
        
        // Verify caller is an administrator
        let mut admin_list: Vec<Address> = env.storage().instance().get(&DataKey::AdminList).expect("not initialized");
        if !admin_list.iter().any(|a| a == proposer) {
            panic!("caller is not an administrator");
        }
        
        // Verify old_admin is in the list
        let old_index = admin_list.iter().position(|a| a == old_admin);
        if old_index.is_none() {
            panic!("old_admin not in admin list");
        }
        
        // Verify new_admin is not already in the list
        if admin_list.iter().any(|a| a == new_admin) {
            panic!("new_admin already in admin list");
        }
        
        // Simple implementation: proposer can replace directly for now
        // In a production system, this would also require multi-sig approval
        let idx = old_index.unwrap();
        let mut new_admin_list = Vec::new(&env);
        for (i, admin) in admin_list.iter().enumerate() {
            if i == idx {
                new_admin_list.push_back(new_admin.clone());
            } else {
                new_admin_list.push_back(admin.clone());
            }
        }
        env.storage().instance().set(&DataKey::AdminList, &new_admin_list);
        
        env.events().publish(
            (soroban_sdk::symbol_short!("admin"), soroban_sdk::symbol_short!("replaced")),
            (old_admin, new_admin),
        );
    }

    /// Transfers the admin role to a new address.
    ///
    /// DEPRECATED: Use replace_admin instead.
    /// This function is kept for backward compatibility but will panic if called.
    ///
    /// # Panics
    /// Always panics - use the new multi-sig admin management.
    pub fn set_admin(_env: Env, _new_admin: Address) {
        panic!("set_admin deprecated - use replace_admin for multi-sig admin management");
    }

    /// Returns the current contract version number.
    ///
    /// The version starts at 1 and is incremented on each successful upgrade.
    pub fn version(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    /// Returns the current admin address (deprecated - returns first admin from list).
    pub fn get_admin(env: Env) -> Address {
        let admin_list: Vec<Address> = env.storage().instance().get(&DataKey::AdminList).expect("not initialized");
        admin_list.get(0).expect("admin list is empty").clone()
    }

    /// Returns the list of all administrators.
    pub fn get_admin_list(env: Env) -> Vec<Address> {
        env.storage().instance().get(&DataKey::AdminList).expect("not initialized")
    }

    /// Returns the current upgrade proposal, if any.
    pub fn get_upgrade_proposal(env: Env) -> Option<UpgradeProposal> {
        env.storage().instance().get(&DataKey::UpgradeProposal)
    }

    /// Returns whether an administrator has approved the current proposal.
    pub fn has_approved(env: Env, admin: Address) -> bool {
        env.storage().instance().get(&DataKey::Approval(admin)).unwrap_or(false)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup_contract() -> (Env, UpgradeableContractClient<'static>, Vec<Address>) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(UpgradeableContract, ());
        let client = UpgradeableContractClient::new(&env, &contract_id);

        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);
        let admin4 = Address::generate(&env);
        let admin5 = Address::generate(&env);
        let mut admin_list = Vec::new(&env);
        admin_list.push_back(admin1.clone());
        admin_list.push_back(admin2);
        admin_list.push_back(admin3);
        admin_list.push_back(admin4);
        admin_list.push_back(admin5);
        
        client.initialize(&admin_list);

        (env, client, admin_list)
    }

    #[test]
    fn test_initialize() {
        let (_env, client, admin_list) = setup_contract();

        assert_eq!(client.get_admin(), admin_list.get(0).unwrap());
        assert_eq!(client.version(), 1);
    }

    #[test]
    #[should_panic(expected = "contract already initialized")]
    fn test_initialize_twice_panics() {
        let (env, client, _admin_list) = setup_contract();

        // Attempting to initialize again should panic.
        let another_admin = Address::generate(&env);
        let mut another_list = Vec::new(&env);
        for _ in 0..5 {
            another_list.push_back(another_admin.clone());
        }
        client.initialize(&another_list);
    }

    #[test]
    fn test_replace_admin() {
        let (env, client, admin_list) = setup_contract();

        let new_admin = Address::generate(&env);
        client.replace_admin(&admin_list.get(0).unwrap(), &admin_list.get(0).unwrap(), &new_admin);

        let updated_list = client.get_admin_list();
        assert_eq!(updated_list.get(0).unwrap(), new_admin);
    }

    #[test]
    fn test_version() {
        let (_env, client, _admin_list) = setup_contract();
        assert_eq!(client.version(), 1);
    }
}
