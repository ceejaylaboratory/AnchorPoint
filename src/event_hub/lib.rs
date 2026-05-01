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

use soroban_sdk::{
    bytes, contract, contractimpl, contracttype, symbol_short, vec, Address, Bytes, Env, String as SorobanString, Map, Vec,
};
use utils::events::{emit_event, AnchorEvent, CrossContractEvent};

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
    /// Event archive: log of all captured cross-contract events
    EventLog,
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
        env.storage()
            .instance()
            .set(&DataKey::EventCounter, &0u64);

        let contracts: Map<Address, bool> = Map::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::RegisteredContracts, &contracts);

        let event_log: Vec<EventLogEntry> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::EventLog, &event_log);

        env.events().publish(
            (symbol_short!("hub"), symbol_short!("init")),
            admin,
        );
    }

    /// Register a new source contract with the Event Hub
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - Must be the initialized admin address
    /// * `contract` - The contract address to register for event capture
    pub fn register_contract(env: Env, admin: Address, contract: Address) {
        admin.require_auth();
        let expected_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("hub not initialized");
        assert_eq!(admin, expected_admin, "unauthorized");

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

        env.events().publish(
            (symbol_short!("hub"), symbol_short!("reg")),
            contract,
        );
    }

    /// Unregister a source contract
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - Must be the initialized admin address
    /// * `contract` - The contract address to unregister
    pub fn unregister_contract(env: Env, admin: Address, contract: Address) {
        admin.require_auth();
        let expected_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("hub not initialized");
        assert_eq!(admin, expected_admin, "unauthorized");

        let mut contracts: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::RegisteredContracts)
            .expect("internal error");

        contracts.remove(contract.clone());
        env.storage()
            .instance()
            .set(&DataKey::RegisteredContracts, &contracts);

        env.events().publish(
            (symbol_short!("hub"), symbol_short!("unreg")),
            contract,
        );
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
        let contracts: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&DataKey::RegisteredContracts)
            .expect("hub not initialized");

        contracts
            .get(contract)
            .map(|v| v)
            .unwrap_or(false)
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
        let is_registered = Self::is_registered(env.clone(), source_contract.clone());
        assert!(is_registered, "source contract not registered");

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

        // Add to event log
        let mut event_log: Vec<EventLogEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::EventLog)
            .unwrap_or_else(|| Vec::new(&env));

        event_log.push_back(log_entry);
        env.storage()
            .persistent()
            .set(&DataKey::EventLog, &event_log);

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
        let event_log: Vec<EventLogEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::EventLog)
            .unwrap_or_else(|| Vec::new(&env));

        let mut result = Vec::new(&env);
        let limit = limit as usize;
        let mut count = 0;

        for i in 0..event_log.len() {
            if count >= limit {
                break;
            }
            let entry = event_log.get(i).unwrap();
            if entry.id >= start_id {
                result.push_back(entry);
                count += 1;
            }
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
        let event_log: Vec<EventLogEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::EventLog)
            .unwrap_or_else(|| Vec::new(&env));

        for i in 0..event_log.len() {
            let entry = event_log.get(i).unwrap();
            if entry.id == event_id {
                return entry;
            }
        }

        panic!("event not found");
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
        let event_log: Vec<EventLogEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::EventLog)
            .unwrap_or_else(|| Vec::new(&env));

        let mut result = Vec::new(&env);
        let limit = limit as usize;
        let mut count = 0;

        for i in 0..event_log.len() {
            if count >= limit {
                break;
            }
            let entry = event_log.get(i).unwrap();
            if entry.source_contract == source_contract {
                result.push_back(entry);
                count += 1;
            }
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

        let mut result = Vec::new(&env);
        for i in 0..contracts.len() {
            if let Some(key) = contracts.key_by_index(i) {
                result.push_back(key);
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as AddressUtils, Ledger};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        assert_eq!(client.get_event_count(), 0);
    }

    #[test]
    fn test_register_contract() {
        let env = Env::default();
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
        env.ledger().set_timestamp(1_000_000u64);

        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let source_contract = Address::generate(&env);
        client.register_contract(&admin, &source_contract);

        let event_type = SorobanString::from_slice(&env, b"transfer");
        let event_data = Bytes::from_slice(&env, b"test_event_data");

        client.capture_event(
            &source_contract,
            &event_type,
            &event_data,
        );

        assert_eq!(client.get_event_count(), 1);

        let events = client.get_events(&0u64, &1u32);
        assert_eq!(events.len(), 1);

        let event = events.get(0).unwrap();
        assert_eq!(event.source_contract, source_contract);
        assert_eq!(event.event_type, event_type);
        assert_eq!(event.event_data, event_data);
    }

    #[test]
    fn test_unregister_contract() {
        let env = Env::default();
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
        let contract_id = env.register(EventHub, ());
        let client = EventHubClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        let contract1 = Address::generate(&env);
        let contract2 = Address::generate(&env);

        client.register_contract(&admin, &contract1);
        client.register_contract(&admin, &contract2);

        let event_type = SorobanString::from_slice(&env, b"transfer");
        let event_data = Bytes::from_slice(&env, b"data");

        client.capture_event(&contract1, &event_type, &event_data);
        client.capture_event(&contract1, &event_type, &event_data);
        client.capture_event(&contract2, &event_type, &event_data);

        let contract1_events = client.get_events_by_contract(&contract1, &10u32);
        assert_eq!(contract1_events.len(), 2);

        let contract2_events = client.get_events_by_contract(&contract2, &10u32);
        assert_eq!(contract2_events.len(), 1);
    }
}
