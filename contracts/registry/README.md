# AnchorPoint Registry Contract

A centralized registry contract that stores the addresses and version numbers of all other AnchorPoint contracts, enabling easy discovery and seamless upgrades across the protocol.

## Overview

The Registry contract serves as the single source of truth for all AnchorPoint protocol contracts. It maintains a mapping of contract types to their deployed addresses, versions, and metadata, making it easy for other contracts and frontend applications to discover and interact with protocol components.

## Features

- **Contract Registration**: Register new contracts or update existing ones
- **Version Management**: Track contract versions and upgrade history
- **Active/Inactive States**: Mark contracts as active or inactive without removal
- **Upgrade Tracking**: Maintain references to previous contract versions
- **Query Functions**: Easy discovery of contract addresses and metadata
- **Admin Controls**: Admin-only operations with pause/unpause functionality
- **Comprehensive Events**: All registry operations emit events for off-chain indexing

## Contract Architecture

### Data Structures

**ContractInfo:**
```rust
pub struct ContractInfo {
    pub address: Address,           // Contract address
    pub version: String,            // Contract version (e.g., "1.0.0")
    pub contract_type: String,     // Contract type (e.g., "AMM", "Lending")
    pub deployed_at: u64,           // Deployment timestamp
    pub active: bool,              // Whether contract is currently active
    pub previous_version: Option<Address>,  // Previous version address
}
```

### Core Functions

#### Registration & Management

- `initialize(admin)` - Initialize the registry with an admin address
- `register_contract(admin, contract_type, address, version)` - Register or update a contract
- `deactivate_contract(admin, contract_type)` - Mark a contract as inactive
- `activate_contract(admin, contract_type)` - Reactivate a deactivated contract
- `remove_contract(admin, contract_type)` - Remove a contract from the registry

#### Admin Functions

- `transfer_admin(admin, new_admin)` - Transfer admin rights to a new address
- `pause(admin)` - Pause registry operations (emergency function)
- `unpause(admin)` - Unpause registry operations

#### Query Functions

- `get_contract(contract_type)` - Get full contract information
- `get_address(contract_type)` - Get contract address by type
- `get_version(contract_type)` - Get contract version by type
- `is_registered(contract_type)` - Check if a contract is registered
- `is_active(contract_type)` - Check if a contract is active
- `get_all_contract_types()` - Get all registered contract types
- `get_active_contracts()` - Get all active contracts
- `get_admin()` - Get the registry admin
- `get_registry_version()` - Get the registry version
- `is_paused()` - Check if the registry is paused
- `get_upgrade_history(contract_type)` - Get upgrade history for a contract

## Usage Example

### Deployment and Initialization

```rust
let env = Env::default();
let admin = Address::generate(&env);
let contract_id = env.register_contract(None, Registry);
let client = RegistryClient::new(&env, &contract_id);

client.initialize(&admin);
```

### Registering Contracts

```rust
let amm_address = Address::generate(&env);
let amm_version = String::from_str(&env, "1.0.0");
let amm_type = String::from_str(&env, "AMM");

client.register_contract(&admin, &amm_type, &amm_address, &amm_version);
```

### Updating Contracts (Upgrades)

```rust
// Register new version
let amm_v2_address = Address::generate(&env);
let amm_v2_version = String::from_str(&env, "2.0.0");

client.register_contract(&admin, &amm_type, &amm_v2_address, &amm_v2_version);

// The previous version is automatically tracked
let info = client.get_contract(amm_type);
assert_eq!(info.previous_version, Some(amm_address));
```

### Querying Contract Information

```rust
// Get AMM contract address
let amm_address = client.get_address(String::from_str(&env, "AMM"));

// Check if contract is active
let is_active = client.is_active(String::from_str(&env, "AMM"));

// Get all active contracts
let active_contracts = client.get_active_contracts();
```

### Managing Contract States

```rust
// Deactivate a contract (e.g., for maintenance)
client.deactivate_contract(&admin, &String::from_str(&env, "AMM"));

// Reactivate when ready
client.activate_contract(&admin, &String::from_str(&env, "AMM"));
```

## Integration with Other Contracts

Other AnchorPoint contracts can use the Registry to discover each other:

```rust
// In AMM contract, discover Lending contract address
let registry_client = RegistryClient::new(&env, &registry_address);
let lending_address = registry_client.get_address(String::from_str(&env, "Lending"));

// Now interact with the Lending contract
let lending_client = LendingClient::new(&env, &lending_address);
```

## Upgrade Workflow

1. Deploy new version of the contract
2. Test the new contract thoroughly
3. Register the new version in the Registry:
   ```rust
   client.register_contract(&admin, &contract_type, &new_address, &new_version);
   ```
4. The old contract address is automatically stored in `previous_version`
5. Update dependent contracts to use the new address (if needed)
6. Optionally deactivate the old contract:
   ```rust
   client.deactivate_contract(&admin, &contract_type);
   ```

## Standard Contract Types

The Registry supports any contract type, but common AnchorPoint types include:

- **AMM** - Automated Market Maker
- **Lending** - Lending protocol
- **Bridge** - Cross-chain bridge
- **XLMWrapper** - Wrapped XLM token
- **LiquidStaking** - Liquid staking
- **FlashLoan** - Flash loan provider
- **Governance** - Governance contract
- **NFTMetadata** - NFT metadata contract

## Security Considerations

1. **Admin Control**: Only the admin can register, update, or remove contracts
2. **Pause Functionality**: Admin can pause registry operations in emergencies
3. **No Direct Removal**: Contracts are deactivated rather than removed to preserve history
4. **Upgrade Tracking**: Previous versions are tracked for audit trails
5. **Event Emission**: All operations emit events for off-chain monitoring

## Testing

Run the test suite:

```bash
cd contracts/registry
cargo test
```

## Building

Build the contract:

```bash
cd contracts/registry
cargo build --target wasm32-unknown-unknown --release
```

## Events

The contract emits events for all operations:

- `init` - Registry initialization
- `register` - Contract registration
- `update` - Contract update
- `deactivate` - Contract deactivation
- `activate` - Contract activation
- `remove` - Contract removal
- `transfer_admin` - Admin transfer
- `pause` - Registry pause
- `unpause` - Registry unpause

These events can be indexed by off-chain services to track registry state changes.

## License

This contract is part of the AnchorPoint project.
