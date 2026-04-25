# Event Hub - Cross-Contract Event Propagation

## Overview

The Event Hub is a central contract that enables cross-contract event propagation and standardized event logging across the AnchorPoint ecosystem. It facilitates easier off-chain indexing by capturing events from multiple source contracts and re-emitting them in a standardized `AnchorEvent` format.

## Key Features

### 1. **Event Registration & Capture**
- Register multiple source contracts for event capture
- Capture raw events from registered contracts
- Automatic timestamp recording for all captured events
- Unique event ID assignment for tracking

### 2. **Standardized Event Schema**
Events are captured and re-emitted using the `CrossContractEvent` structure:

```rust
pub struct CrossContractEvent {
    pub source_contract: Address,    // Origin contract
    pub timestamp: u64,               // Capture time (seconds)
    pub event_data: Bytes,            // Raw event payload
    pub event_type: String,           // Event category/type
}
```

### 3. **Event Storage & Querying**
- Persistent event log with full history
- Pagination support for querying large event sets
- Filters by contract, time, and event type
- Event counter for tracking total events

### 4. **Admin Controls**
- Initialize the hub with an admin address
- Register/unregister source contracts
- Query registration status

## Architecture

### Storage Layout

```
DataKey::Admin                 → Admin address
DataKey::RegisteredContracts   → Map<Address, bool> of registered contracts
DataKey::EventCounter          → u64 total event count
DataKey::EventLog              → Vec<EventLogEntry> persistent event history
```

### Event Flow

```
Source Contract
    ↓
    emit_event()
    ↓
Event Hub
    ↓
    capture_event()
    ↓
    ┌─────────────────────────────┐
    │                             │
    ├→ Store in EventLog          ├→ Re-emit as AnchorEvent
    │                             │
    └─────────────────────────────┘
         ↓
    Off-chain Indexers
```

## Usage Example

### 1. Initialize the Hub

```rust
let admin = Address::generate(&env);
client.initialize(&admin);
```

### 2. Register Source Contracts

```rust
let contract_addr = Address::from_contract_id(&env, &contract_id);
client.register_contract(&admin, &contract_addr);
```

### 3. Capture Events

When a source contract emits an event, call:

```rust
let event_type = SorobanString::from_slice(&env, b"transfer");
let event_data = Bytes::from_slice(&env, b"<encoded_event>");

client.capture_event(
    &source_contract,
    &event_type,
    &event_data,
);
```

### 4. Query Events

```rust
// Get total event count
let count = client.get_event_count();

// Get events with pagination
let events = client.get_events(&0u64, &100u32);

// Get events from specific contract
let contract_events = client.get_events_by_contract(&contract_addr, &50u32);

// Get specific event by ID
let event = client.get_event(&1u64);
```

## Off-Chain Indexing

The Event Hub emits `CrossContractEvent` as part of the standardized `AnchorEvent` enum, which allows off-chain indexers to:

1. **Listen for Events**: Monitor all events published with `symbol_short!("anchor")` and `symbol_short!("x_contract")` topics
2. **Store Metadata**: Access source contract, timestamp, and event type for filtering
3. **Process Events**: Decode the `event_data` based on `event_type` for database storage
4. **Query History**: Use pagination APIs to build complete event histories

### Example Indexer Integration

```javascript
// Listen for cross-contract events
provider.on('contract:event', async (event) => {
    if (event.topic[0] === 'anchor' && event.topic[1] === 'x_contract') {
        const payload = event.data;
        
        // Store in database
        await db.events.insert({
            id: payload.event_id,
            source: payload.source_contract,
            timestamp: payload.timestamp,
            type: payload.event_type,
            data: payload.event_data,
        });
    }
});
```

## API Reference

### Admin Functions

#### `initialize(admin: Address)`
Initialize the Event Hub with an admin address.

#### `register_contract(admin: Address, contract: Address)`
Register a contract for event capture.

#### `unregister_contract(admin: Address, contract: Address)`
Unregister a contract from event capture.

### Query Functions

#### `is_registered(contract: Address) -> bool`
Check if a contract is registered.

#### `get_event_count() -> u64`
Get total number of captured events.

#### `get_events(start_id: u64, limit: u32) -> Vec<EventLogEntry>`
Get events with pagination support.

#### `get_event(event_id: u64) -> EventLogEntry`
Get a specific event by ID.

#### `get_events_by_contract(contract: Address, limit: u32) -> Vec<EventLogEntry>`
Get events from a specific source contract.

#### `get_registered_contracts() -> Vec<Address>`
Get all registered contracts.

### Event Capture

#### `capture_event(source_contract: Address, event_type: String, event_data: Bytes)`
Capture and log an event from a registered source contract.

## Implementation Details

### Constraints
- Maximum 100 registered contracts per hub instance
- Event counter is u64, allowing up to 2^64 events before overflow
- Event log uses persistent storage for long-term retention

### Event IDs
- Sequentially assigned starting from 1
- Increment on each capture operation
- Guaranteed unique within a hub instance

### Timestamps
- Captured using `env.ledger().timestamp()`
- Represents seconds from epoch
- Consistent across all events in the same ledger block

## Testing

Run tests with:

```bash
cd src/event_hub
cargo test
```

Key test scenarios:
- Hub initialization
- Contract registration/unregistration
- Single and batch event capture
- Event retrieval with pagination
- Contract-specific event queries
- Authorization checks

## Future Enhancements

1. **Event Filtering**: Add more granular filtering capabilities (by time range, event type)
2. **Event Expiry**: Implement automatic cleanup of old events
3. **Event Compression**: Compress event data for storage efficiency
4. **Multi-Hub Federation**: Enable event propagation across multiple hub instances
5. **Event Replay**: Expose functionality to replay historical events
6. **Real-time Subscriptions**: Support subscription-based event streaming for indexers

## Integration Guide

To integrate a contract with the Event Hub:

1. Deploy the Event Hub contract
2. Register your source contract with the hub's admin
3. When your contract emits an event, also call the hub's `capture_event` function
4. Set up off-chain indexers to listen for `AnchorEvent::CrossContractEvent` emissions

This ensures your events are captured in the centralized log and available for indexing.
