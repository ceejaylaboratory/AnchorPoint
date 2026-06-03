#![no_std]
//! Event Hub Contract for Cross-Contract Event Propagation
//!
//! This contract serves as a central hub for capturing and re-emitting events
//! from multiple source contracts, facilitating easier off-chain indexing.
//!
//! Key features:
//! - Register multiple source contracts
//! - Capture events from source contracts
//! - Re-emit events in standardized AnchorEvent format
//! - Maintain event log with timestamps and metadata
//! - Query event history for indexers

use anchorpointutils::events::{emit_event, AnchorEvent, CrossContractEvent};
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, Env, Map,
    String as SorobanString, Vec,
};

const MAX_REGISTERED_CONTRACTS: usize = 100;

// ── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Hub admin address
    Admin,
    /// Map of registered source contracts (Address -> bool)
    RegisteredContracts,
    /// Event counter for generating unique event IDs
    EventCounter,
    /// Event archive entry keyed by event id.
    EventLogEntry(u64),
}

// ── Contract Types ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct EventLogEntry {
    /// Unique ID for this event in the log
    pub id: u64,
    /// The contract that emitted this event
    pub source_contract: Address,
    /// Timestamp when captured (in seconds)
    pub timestamp: u64,
    /// Event type/category
    pub event_type: SorobanString,
    /// Raw event data
    pub event_data: Bytes,
}

// ── Contract Implementation ──────────────────────────────────────────────────

#[contract]
pub struct EventHub;

#[contractimpl]
impl EventHub {
    /// Initialize the Event Hub contract
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - The admin address authorized to register contracts
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::EventCounter, &0u64);

        let contracts: Map<Address, bool> = Map::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::RegisteredContracts, &contracts);

        let event_log: Vec<EventLogEntry> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::EventLog, &event_log);

        env.events()
            .publish((symbol_short!("hub"), symbol_short!("init")), admin);
    }

    /// Register a new source contract with the Event Hub
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - Must be the initialized admin address
    /// * `contract` - The contract address to register for event capture
    pub fn register_contract(env: Env, admin: Address, contract: Address) {
        Self::require_admin(&env, &admin);

        let mut contracts: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::RegisteredContracts)
            .expect("internal error");

        if contracts.len() as usize >= MAX_REGISTERED_CONTRACTS {
            panic!("maximum registered contracts exceeded");
        }

        contracts.set(contract.clone(), true);
        env.storage()
            .instance()
            .set(&DataKey::RegisteredContracts, &contracts);

        env.events()
            .publish((symbol_short!("hub"), symbol_short!("reg")), contract);
    }

    /// Unregister a source contract
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - Must be the initialized admin address
    /// * `contract` - The contract address to unregister
    pub fn unregister_contract(env: Env, admin: Address, contract: Address) {
        Self::require_admin(&env, &admin);

        let mut contracts: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::RegisteredContracts)
            .expect("internal error");

        contracts.remove(contract.clone());
        env.storage()
            .instance()
            .set(&DataKey::RegisteredContracts, &contracts);

        env.events()
            .publish((symbol_short!("hub"), symbol_short!("unreg")), contract);
    }

    /// Check if a contract is registered
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `contract` - The contract address to check
    ///
    /// # Returns
    /// `true` if the contract is registered, `false` otherwise
    pub fn is_registered(env: Env, contract: Address) -> bool {
        Self::is_registered_source(&env, &contract)
        let contracts: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::RegisteredContracts)
            .expect("hub not initialized");

        contracts.get(contract).map(|v| v).unwrap_or(false)
    }

    /// Capture and re-emit an event from a source contract
    ///
    /// This function is called to record an event that originated from a registered contract.
    /// The event is logged and re-emitted in standardized AnchorEvent format for indexing.
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `source_contract` - The address of the contract that emitted the event
    /// * `event_type` - The type/category of the event
    /// * `event_data` - The raw event data bytes
    pub fn capture_event(
        env: Env,
        source_contract: Address,
        event_type: SorobanString,
        event_data: Bytes,
    ) {
        // Verify source contract is registered
        let is_registered = Self::is_registered_source(&env, &source_contract);
        assert!(is_registered, "source contract not registered");
        Self::require_registered_source(&env, &source_contract);

        // Get current timestamp
        let timestamp = env.ledger().timestamp();

        // Increment event counter
        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EventCounter)
            .unwrap_or(0u64);
        let new_counter = counter.checked_add(1).expect("counter overflow");
        env.storage()
            .instance()
            .set(&DataKey::EventCounter, &new_counter);

        // Create log entry
        let log_entry = EventLogEntry {
            id: new_counter,
            source_contract: source_contract.clone(),
            timestamp,
            event_type: event_type.clone(),
            event_data: event_data.clone(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::EventLogEntry(new_counter), &log_entry);

        // Create and emit cross-contract event
        let cross_contract_event = CrossContractEvent {
            source_contract,
            timestamp,
            event_data,
            event_type,
        };

        emit_event(&env, AnchorEvent::CrossContractEvent(cross_contract_event));
    }

    /// Get the count of events in the log
    ///
    /// # Arguments
    /// * `env` - The contract environment
    ///
    /// # Returns
    /// The total number of events captured
    pub fn get_event_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EventCounter)
            .unwrap_or(0u64)
    }

    /// Get events from the log with pagination
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `start_id` - Starting event ID (inclusive)
    /// * `limit` - Maximum number of events to return
    ///
    /// # Returns
    /// A vector of EventLogEntry items
    pub fn get_events(env: Env, start_id: u64, limit: u32) -> Vec<EventLogEntry> {
        let mut result = Vec::new(&env);
        let counter = Self::get_event_count(env.clone());
        let mut event_id = start_id;

        while event_id <= counter && result.len() < limit {
            if event_id == 0 {
                event_id = 1;
                continue;
            }

            if let Some(entry) = Self::get_event_entry(&env, event_id) {
                result.push_back(entry);
            }

            if event_id == u64::MAX {
                break;
            }
            event_id += 1;
        }

        result
    }

    /// Get a specific event by ID
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `event_id` - The ID of the event to retrieve
    ///
    /// # Returns
    /// The EventLogEntry if found, panics otherwise
    pub fn get_event(env: Env, event_id: u64) -> EventLogEntry {
        Self::get_event_entry(&env, event_id).expect("event not found")
    }

    /// Get events from a specific source contract
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `source_contract` - The contract address to filter by
    /// * `limit` - Maximum number of events to return
    ///
    /// # Returns
    /// A vector of EventLogEntry items from the specified contract
    pub fn get_events_by_contract(
        env: Env,
        source_contract: Address,
        limit: u32,
    ) -> Vec<EventLogEntry> {
        let mut result = Vec::new(&env);
        let counter = Self::get_event_count(env.clone());
        let mut event_id = 1u64;

        while event_id <= counter && result.len() < limit {
            if let Some(entry) = Self::get_event_entry(&env, event_id) {
                if entry.source_contract == source_contract {
                    result.push_back(entry);
                }
            }

            if event_id == u64::MAX {
                break;
            }
            event_id += 1;
        }

        result
    }

    /// Get all registered contracts
    ///
    /// # Arguments
    /// * `env` - The contract environment
    ///
    /// # Returns
    /// A vector of all registered contract addresses
    pub fn get_registered_contracts(env: Env) -> Vec<Address> {
        let contracts: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::RegisteredContracts)
            .expect("hub not initialized");

        contracts.keys()
    }
        let mut result = Vec::new(&env);
        let keys = contracts.keys();
        for i in 0..keys.len() {
            result.push_back(keys.get(i).unwrap());
        }

    fn is_registered_source(env: &Env, contract: &Address) -> bool {
        let contracts: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::RegisteredContracts)
            .expect("hub not initialized");

        contracts.get(contract.clone()).unwrap_or(false)
    }

    fn get_event_entry(env: &Env, event_id: u64) -> Option<EventLogEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::EventLogEntry(event_id))
    }

    /// Require authorization from the initialized hub admin.
    fn require_admin(env: &Env, admin: &Address) {
        admin.require_auth();
        let expected_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("hub not initialized");
        assert_eq!(*admin, expected_admin, "unauthorized");
    }

    /// Require that a source is registered and authorizes the capture.
    fn require_registered_source(env: &Env, source_contract: &Address) {
        let contracts: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::RegisteredContracts)
            .expect("hub not initialized");
        let is_registered = contracts.get(source_contract.clone()).unwrap_or(false);
        assert!(is_registered, "source contract not registered");
        source_contract.require_auth();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl,
        testutils::{Address as AddressUtils, Ledger},
    };

    #[contract]
    pub struct MockSourceContract;

    #[contractimpl]
    impl MockSourceContract {
        pub fn capture_to_hub(
            env: Env,
            hub: Address,
            event_type: SorobanString,
            event_data: Bytes,
        ) {
            let source_contract = env.current_contract_address();
            env.invoke_contract::<()>(
                &hub,
                &soroban_sdk::Symbol::new(&env, "capture_event"),
                soroban_sdk::vec![
                    &env,
                    source_contract.to_val(),
                    event_type.to_val(),
                    event_data.to_val()
                ],
            );
        }
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        assert_eq!(client.get_event_count(), 0);
    }

    #[test]
    fn test_register_contract() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let source_contract = Address::generate(&env);
        client.register_contract(&admin, &source_contract);

        assert!(client.is_registered(&source_contract));
    }

    #[test]
    fn test_capture_event() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000u64);

        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let source_contract = Address::generate(&env);
        client.register_contract(&admin, &source_contract);

        let event_type = SorobanString::from_str(&env, "transfer");
        let event_data = Bytes::from_slice(&env, b"test_event_data");

        client.capture_event(&source_contract, &event_type, &event_data);

        assert_eq!(client.get_event_count(), 1);

        let events = client.get_events(&0u64, &1u32);
        assert_eq!(events.len(), 1);

        let event = events.get(0).unwrap();
        assert_eq!(event.source_contract, source_contract);
        assert_eq!(event.event_type, event_type);
        assert_eq!(event.event_data, event_data);
    }

    #[test]
    fn test_registered_contract_invoker_can_capture_event_without_mocked_source_auth() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000_000u64);

        let hub_id = env.register(EventHub, ());
        let hub_client = EventHubClient::new(&env, &hub_id);

        let admin = Address::generate(&env);
        hub_client.initialize(&admin);

        let source_id = env.register(MockSourceContract, ());
        let source_client = MockSourceContractClient::new(&env, &source_id);
        hub_client.register_contract(&admin, &source_id);

        // Disable broad auth mocking; the source authorization below must pass
        // through Soroban's direct contract-invoker auth path.
        env.set_auths(&[]);

        let event_type = SorobanString::from_str(&env, "transfer");
        let event_data = Bytes::from_slice(&env, b"test_event_data");
        source_client.capture_to_hub(&hub_id, &event_type, &event_data);

        assert_eq!(hub_client.get_event_count(), 1);
        let event = hub_client.get_event(&1);
        assert_eq!(event.source_contract, source_id);
        assert_eq!(event.event_type, event_type);
        assert_eq!(event.event_data, event_data);
    }

    #[test]
    fn test_unregister_contract() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let source_contract = Address::generate(&env);
        client.register_contract(&admin, &source_contract);
        assert!(client.is_registered(&source_contract));

        client.unregister_contract(&admin, &source_contract);
        assert!(!client.is_registered(&source_contract));
    }

    #[test]
    fn test_get_events_by_contract() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let contract1 = Address::generate(&env);
        let contract2 = Address::generate(&env);

        client.register_contract(&admin, &contract1);
        client.register_contract(&admin, &contract2);

        let event_type = SorobanString::from_str(&env, "transfer");
        let event_data = Bytes::from_slice(&env, b"data");

        client.capture_event(&contract1, &event_type, &event_data);
        client.capture_event(&contract1, &event_type, &event_data);
        client.capture_event(&contract2, &event_type, &event_data);

        let contract1_events = client.get_events_by_contract(&contract1, &10u32);
        assert_eq!(contract1_events.len(), 2);

        let contract2_events = client.get_events_by_contract(&contract2, &10u32);
        assert_eq!(contract2_events.len(), 1);
    }

    // ── Double-init guard ─────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);
        client.initialize(&admin);
    }

    // ── Unregistered source contract ─────────────────────────────────────────

    #[test]
    #[should_panic(expected = "source contract not registered")]
    fn test_capture_from_unregistered_contract_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let unregistered = Address::generate(&env);
        let event_type = SorobanString::from_slice(&env, b"transfer");
        let event_data = Bytes::from_slice(&env, b"data");
        client.capture_event(&unregistered, &event_type, &event_data);
    }

    // ── get_event by ID ──────────────────────────────────────────────────────

    #[test]
    fn test_get_event_by_id() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(2_000_000u64);

        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let source = Address::generate(&env);
        client.register_contract(&admin, &source);

        let event_type = SorobanString::from_slice(&env, b"stake");
        let event_data = Bytes::from_slice(&env, b"payload");
        client.capture_event(&source, &event_type, &event_data);

        let entry = client.get_event(&1u64);
        assert_eq!(entry.id, 1u64);
        assert_eq!(entry.source_contract, source);
        assert_eq!(entry.event_type, event_type);
        assert_eq!(entry.event_data, event_data);
        assert_eq!(entry.timestamp, 2_000_000u64);
    }

    #[test]
    #[should_panic(expected = "event not found")]
    fn test_get_event_not_found_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        client.get_event(&99u64);
    }

    // ── Event counter ─────────────────────────────────────────────────────────

    #[test]
    fn test_event_counter_increments_per_capture() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);
        assert_eq!(client.get_event_count(), 0);

        let source = Address::generate(&env);
        client.register_contract(&admin, &source);

        let event_type = SorobanString::from_slice(&env, b"tx");
        let event_data = Bytes::from_slice(&env, b"d");

        client.capture_event(&source, &event_type, &event_data);
        assert_eq!(client.get_event_count(), 1);

        client.capture_event(&source, &event_type, &event_data);
        assert_eq!(client.get_event_count(), 2);

        client.capture_event(&source, &event_type, &event_data);
        assert_eq!(client.get_event_count(), 3);
    }

    // ── Pagination ────────────────────────────────────────────────────────────

    #[test]
    fn test_get_events_pagination() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let source = Address::generate(&env);
        client.register_contract(&admin, &source);

        let event_type = SorobanString::from_slice(&env, b"evt");
        let event_data = Bytes::from_slice(&env, b"data");

        for _ in 0..5 {
            client.capture_event(&source, &event_type, &event_data);
        }

        // First page — events 1-3
        let page1 = client.get_events(&1u64, &3u32);
        assert_eq!(page1.len(), 3);
        assert_eq!(page1.get(0).unwrap().id, 1u64);
        assert_eq!(page1.get(2).unwrap().id, 3u64);

        // Second page — events 4-5
        let page2 = client.get_events(&4u64, &10u32);
        assert_eq!(page2.len(), 2);
        assert_eq!(page2.get(0).unwrap().id, 4u64);

        // Zero limit returns nothing
        let empty = client.get_events(&1u64, &0u32);
        assert_eq!(empty.len(), 0);
    }

    // ── get_registered_contracts ──────────────────────────────────────────────

    #[test]
    fn test_get_registered_contracts() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        // No contracts registered initially
        let registered = client.get_registered_contracts();
        assert_eq!(registered.len(), 0);

        let c1 = Address::generate(&env);
        let c2 = Address::generate(&env);
        client.register_contract(&admin, &c1);
        client.register_contract(&admin, &c2);

        let registered = client.get_registered_contracts();
        assert_eq!(registered.len(), 2);
    }

    // ── Unauthorized access ───────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_register_unauthorized_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let impostor = Address::generate(&env);
        let source = Address::generate(&env);
        // impostor != admin so the assert_eq inside register_contract panics
        client.register_contract(&impostor, &source);
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_unregister_unauthorized_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let source = Address::generate(&env);
        client.register_contract(&admin, &source);

        let impostor = Address::generate(&env);
        client.unregister_contract(&impostor, &source);
    }

    // ── Unregister then capture panics ────────────────────────────────────────

    #[test]
    #[should_panic(expected = "source contract not registered")]
    fn test_capture_after_unregister_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let source = Address::generate(&env);
        client.register_contract(&admin, &source);
        client.unregister_contract(&admin, &source);

        let event_type = SorobanString::from_slice(&env, b"transfer");
        let event_data = Bytes::from_slice(&env, b"data");
        // Should panic — contract was unregistered
        client.capture_event(&source, &event_type, &event_data);
    }
}
