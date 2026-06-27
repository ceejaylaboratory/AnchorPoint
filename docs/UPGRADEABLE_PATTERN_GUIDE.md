# AnchorPoint Upgradeable Pattern - Comprehensive Guide

This guide provides comprehensive technical documentation on how the AnchorPoint upgradeable pattern works, including storage layout best practices, upgrade mechanisms, and security considerations.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Storage Layout Best Practices](#storage-layout-best-practices)
4. [Upgrade Mechanism](#upgrade-mechanism)
5. [Security Considerations](#security-considerations)
6. [Implementation Patterns](#implementation-patterns)
7. [Migration Strategies](#migration-strategies)
8. [Testing and Verification](#testing-and-verification)
9. [Examples](#examples)

## Overview

The AnchorPoint upgradeable pattern enables smart contracts to be upgraded without losing their state or requiring users to migrate to a new contract address. This is achieved through Soroban's built-in upgrade functionality combined with careful storage layout design.

### Key Benefits

- **Seamless Upgrades**: Upgrade contract logic while preserving state
- **No Migration Required**: Users don't need to interact with new contract addresses
- **Backward Compatibility**: Maintain compatibility with existing integrations
- **Governance Control**: Admin-controlled upgrade process with security checks
- **Version Tracking**: Automatic version tracking for audit trails

### Core Components

1. **Storage Layout**: Structured data organization using `DataKey` enums
2. **Upgrade Function**: Admin-controlled WASM update mechanism
3. **Security Registry**: Optional pause/resume functionality
4. **Version Management**: Automatic version incrementing
5. **Access Control**: Admin-only upgrade authorization

## Architecture

### Contract Structure

```rust
#[contract]
pub struct UpgradeableContract;

#[contractimpl]
impl UpgradeableContract {
    // Storage keys
    // Initialization
    // Upgrade logic
    // Admin management
    // Version tracking
}
```

### Storage Key Pattern

All AnchorPoint contracts use a consistent `DataKey` enum pattern for storage organization:

```rust
#[derive(Clone)]
#[contracttype]
enum DataKey {
    // Configuration keys
    Admin,
    Version,
    
    // State keys
    Balance(Address),
    Stake(Address),
    
    // Metadata keys
    TokenMetadata(u64),
}
```

### Storage Types

Soroban provides three storage types with different characteristics:

| Storage Type | Lifetime | Use Case | Cost |
|-------------|----------|----------|------|
| **Instance** | Contract lifetime | Configuration, admin, version | Low |
| **Persistent** | Indefinite (with TTL) | User balances, stakes | Medium |
| **Temporary** | Single invocation | Reentrancy guards, locks | Free |

## Storage Layout Best Practices

### 1. Use DataKey Enums for Organization

**✅ Recommended:**
```rust
#[derive(Clone)]
#[contracttype]
enum DataKey {
    // Group related keys together
    Admin,
    Version,
    Token,
    
    // User-specific data with Address parameter
    Balance(Address),
    Stake(Address),
    Allowance(Address, Address),
    
    // Token-specific data with ID parameter
    TotalSupply(u64),
    TokenMetadata(u64),
}
```

**❌ Avoid:**
```rust
// Magic symbols without structure
env.storage().instance().set(&symbol_short!("admin"), &admin);
env.storage().instance().set(&symbol_short!("bal"), &balance);
```

### 2. Separate Instance and Persistent Storage

**Instance Storage** - For contract configuration:
```rust
// Store in instance storage (low cost, contract lifetime)
env.storage().instance().set(&DataKey::Admin, &admin);
env.storage().instance().set(&DataKey::Version, &1u32);
env.storage().instance().set(&DataKey::Token, &token_address);
```

**Persistent Storage** - For user data:
```rust
// Store in persistent storage (medium cost, indefinite with TTL)
env.storage()
    .persistent()
    .set(&DataKey::Balance(user), &balance);
env.storage()
    .persistent()
    .set(&DataKey::Stake(user), &stake_info);
```

### 3. Use Parameterized Keys for Maps

For mapping addresses to values, use parameterized enum variants:

```rust
#[contracttype]
enum DataKey {
    Balance(Address),           // Single-parameter key
    Allowance(Address, Address), // Multi-parameter key
    Stake(Address),
}

// Usage
env.storage()
    .persistent()
    .set(&DataKey::Balance(user_address), &balance);

env.storage()
    .persistent()
    .set(&DataKey::Allowance(owner, spender), &amount);
```

### 4. Initialize Storage Once

Always check for initialization to prevent re-initialization attacks:

```rust
pub fn initialize(env: Env, admin: Address) {
    // Prevent re-initialization
    if env.storage().instance().has(&DataKey::Admin) {
        panic!("contract already initialized");
    }
    
    admin.require_auth();
    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage().instance().set(&DataKey::Version, &1u32);
}
```

### 5. Use TTL for Persistent Storage

Set appropriate TTL for persistent storage to manage costs:

```rust
// Extend TTL when updating data
env.storage()
    .persistent()
    .set(&DataKey::Stake(user), &stake_info);
env.storage()
    .persistent()
    .extend_ttl(&DataKey::Stake(user), 100, 1000);
```

### 6. Storage Layout Compatibility

When upgrading, maintain storage layout compatibility:

**✅ Compatible Changes:**
- Adding new storage keys
- Adding new enum variants
- Adding new fields to structs (with default values)

**❌ Incompatible Changes:**
- Removing storage keys
- Renaming enum variants
- Changing field types in stored structs
- Reordering enum variants

### 7. Use Structs for Complex Data

Group related data into structs:

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakeInfo {
    pub amount: i128,
    pub last_updated: u64,
    pub accumulated_rewards: i128,
    pub lock_end: u64,
}

// Store as single value
env.storage()
    .persistent()
    .set(&DataKey::Stake(user), &stake_info);
```

### 8. Temporary Storage for Reentrancy Guards

Use temporary storage for single-invocation data:

```rust
#[contracttype]
enum ReentrancyGuardKey {
    Locked,
}

// Set lock
env.storage()
    .temporary()
    .set(&ReentrancyGuardKey::Locked, &true);

// Release lock
env.storage()
    .temporary()
    .remove(&ReentrancyGuardKey::Locked);
```

## Upgrade Mechanism

### Upgrade Function

The core upgrade function in AnchorPoint contracts:

```rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
    // 1. Check security registry (optional)
    if let Some(registry) = env.storage()
        .instance()
        .get::<_, Address>(&symbol_short!("sec_reg")) 
    {
        let is_paused: bool = env.invoke_contract(
            &registry, 
            &Symbol::new(&env, "is_paused"), 
            vec![&env]
        );
        if is_paused {
            panic!("contract is paused");
        }
    }

    // 2. Verify admin authorization
    let admin: Address = env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap();
    admin.require_auth();

    // 3. Increment version
    let current_version: u32 = env.storage()
        .instance()
        .get(&DataKey::Version)
        .unwrap_or(1);
    env.storage()
        .instance()
        .set(&DataKey::Version, &(current_version + 1));

    // 4. Perform upgrade
    env.deployer().update_current_contract_wasm(new_wasm_hash);
}
```

### Upgrade Process Flow

1. **Install New WASM**: Deploy new contract code to network
   ```bash
   soroban contract install --wasm new_contract.wasm
   ```

2. **Get WASM Hash**: Retrieve the hash of installed WASM
   ```bash
   soroban contract install --wasm new_contract.wasm --output-id
   ```

3. **Call Upgrade**: Invoke upgrade function with WASM hash
   ```bash
   soroban contract invoke \
     --id <contract_id> \
     --fn upgrade \
     --arg <wasm_hash> \
     --source <admin_address>
   ```

4. **Verify Upgrade**: Check version increment
   ```bash
   soroban contract invoke --id <contract_id> --fn version
   ```

### Version Tracking

Automatic version tracking ensures audit trail:

```rust
pub fn version(env: Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::Version)
        .unwrap_or(0)
}
```

## Security Considerations

### 1. Admin Authorization

Always verify admin authorization before upgrade:

```rust
let admin: Address = env.storage()
    .instance()
    .get(&DataKey::Admin)
    .unwrap();
admin.require_auth(); // Critical security check
```

### 2. Security Registry Integration

Optional pause functionality via security registry:

```rust
pub fn set_security_registry(env: Env, registry: Address) {
    if env.storage().instance().has(&symbol_short!("sec_reg")) {
        panic!("already set");
    }
    env.storage()
        .instance()
        .set(&symbol_short!("sec_reg"), &registry);
}

// Check before sensitive operations
if let Some(registry) = env.storage()
    .instance()
    .get::<_, Address>(&symbol_short!("sec_reg")) 
{
    let is_paused: bool = env.invoke_contract(
        &registry, 
        &Symbol::new(&env, "is_paused"), 
        vec![&env]
    );
    if is_paused {
        panic!("contract is paused");
    }
}
```

### 3. Admin Transfer Control

Allow secure admin transfer:

```rust
pub fn set_admin(env: Env, new_admin: Address) {
    let admin: Address = env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap();
    admin.require_auth(); // Current admin must authorize
    env.storage()
        .instance()
        .set(&DataKey::Admin, &new_admin);
}
```

### 4. Time-Lock Considerations

For critical contracts, consider implementing time-locks:

```rust
pub fn schedule_upgrade(env: Env, new_wasm_hash: BytesN<32>, delay: u64) {
    let admin: Address = env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap();
    admin.require_auth();
    
    let execute_at = env.ledger().timestamp() + delay;
    env.storage()
        .instance()
        .set(&DataKey::ScheduledUpgrade, &(new_wasm_hash, execute_at));
}

pub fn execute_scheduled_upgrade(env: Env) {
    let (wasm_hash, execute_at): (BytesN<32>, u64) = env.storage()
        .instance()
        .get(&DataKey::ScheduledUpgrade)
        .unwrap();
    
    if env.ledger().timestamp() < execute_at {
        panic!("upgrade not yet executable");
    }
    
    env.deployer().update_current_contract_wasm(wasm_hash);
}
```

### 5. Upgrade Validation

Validate new WASM before upgrade:

```rust
pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
    let admin: Address = env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap();
    admin.require_auth();

    // Optional: Validate WASM hash against allowlist
    if !Self::is_allowed_wasm(&env, new_wasm_hash) {
        panic!("wasm hash not in allowlist");
    }

    // ... rest of upgrade logic
}
```

## Implementation Patterns

### Pattern 1: Basic Upgradeable Contract

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    Version,
}

#[contract]
pub struct UpgradeableContract;

#[contractimpl]
impl UpgradeableContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Version, &1u32);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        admin.require_auth();

        let current_version: u32 = env.storage()
            .instance()
            .get(&DataKey::Version)
            .unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &(current_version + 1));

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Version)
            .unwrap_or(0)
    }
}
```

### Pattern 2: Upgradeable with State

```rust
#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    Version,
    Token,
    Balance(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BalanceInfo {
    pub amount: i128,
    pub last_updated: u64,
}

#[contractimpl]
impl UpgradeableContract {
    pub fn initialize(env: Env, admin: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Version, &1u32);
        env.storage().instance().set(&DataKey::Token, &token);
    }

    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();
        
        let mut balance = Self::get_balance(env.clone(), user.clone());
        balance.amount += amount;
        balance.last_updated = env.ledger().timestamp();
        
        env.storage()
            .persistent()
            .set(&DataKey::Balance(user), &balance);
    }

    pub fn get_balance(env: Env, user: Address) -> BalanceInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(user))
            .unwrap_or(BalanceInfo {
                amount: 0,
                last_updated: 0,
            })
    }
}
```

### Pattern 3: Upgradeable with Security Registry

```rust
#[contractimpl]
impl UpgradeableContract {
    pub fn set_security_registry(env: Env, registry: Address) {
        if env.storage().instance().has(&symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage()
            .instance()
            .set(&symbol_short!("sec_reg"), &registry);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        // Check pause status
        if let Some(registry) = env.storage()
            .instance()
            .get::<_, Address>(&symbol_short!("sec_reg")) 
        {
            let is_paused: bool = env.invoke_contract(
                &registry, 
                &Symbol::new(&env, "is_paused"), 
                vec![&env]
            );
            if is_paused {
                panic!("contract is paused");
            }
        }

        // Verify admin
        let admin: Address = env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        admin.require_auth();

        // Upgrade
        let current_version: u32 = env.storage()
            .instance()
            .get(&DataKey::Version)
            .unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &(current_version + 1));
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}
```

## Migration Strategies

### Strategy 1: Storage-Only Migration

When adding new fields without changing logic:

```rust
// Version 1
#[contracttype]
pub struct StakeInfo {
    pub amount: i128,
    pub last_updated: u64,
}

// Version 2 - Add new field
#[contracttype]
pub struct StakeInfo {
    pub amount: i128,
    pub last_updated: u64,
    pub reward_debt: i128, // New field
}

// Migration function
pub fn migrate_v1_to_v2(env: Env) {
    let admin: Address = env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap();
    admin.require_auth();

    // Migrate existing stakes
    // (implementation depends on data access pattern)
}
```

### Strategy 2: Function Signature Migration

When changing function signatures:

```rust
// Version 1
pub fn stake(env: Env, user: Address, amount: i128) {
    // Old implementation
}

// Version 2 - Add lock period
pub fn stake(env: Env, user: Address, amount: i128, lock_period: u64) {
    // New implementation
}

// Keep old function for compatibility
pub fn stake_v1(env: Env, user: Address, amount: i128) {
    Self:: stake(env, user, amount, DEFAULT_LOCK_PERIOD);
}
```

### Strategy 3: Data Structure Migration

When changing data structures:

```rust
// Version 1 - Flat balances
env.storage()
    .persistent()
    .set(&DataKey::Balance(user), &amount);

// Version 2 - Struct with metadata
env.storage()
    .persistent()
    .set(&DataKey::Balance(user), &BalanceInfo {
        amount,
        last_updated: env.ledger().timestamp(),
    });

// Migration
pub fn migrate_balances(env: Env) {
    // Read old format, write new format
    // (requires knowing all users or using iterator)
}
```

## Testing and Verification

### Unit Tests for Upgrade Logic

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_upgrade_increments_version() {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register(UpgradeableContract, ());
        let client = UpgradeableContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);
        
        assert_eq!(client.version(), 1);
        
        let new_wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
        client.upgrade(&new_wasm_hash);
        
        assert_eq!(client.version(), 2);
    }

    #[test]
    #[should_panic(expected = "contract already initialized")]
    fn test_initialize_twice_panics() {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register(UpgradeableContract, ());
        let client = UpgradeableContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        client.initialize(&admin);
        
        let another_admin = Address::generate(&env);
        client.initialize(&another_admin);
    }
}
```

### Storage Compatibility Tests

```rust
#[test]
fn test_storage_layout_compatibility() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register(UpgradeableContract, ());
    let client = UpgradeableContractClient::new(&env, &contract_id);
    
    // Write data with version 1
    let user = Address::generate(&env);
    client.deposit(&user, &1000);
    
    // Simulate upgrade
    let new_wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&new_wasm_hash);
    
    // Verify data is still accessible
    let balance = client.get_balance(&user);
    assert_eq!(balance.amount, 1000);
}
```

### Integration Tests

```rust
#[test]
fn test_full_upgrade_workflow() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Deploy version 1
    let contract_id = env.register(UpgradeableContract, ());
    let client = UpgradeableContractClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    client.initialize(&admin);
    
    // Add some state
    let user = Address::generate(&env);
    client.deposit(&user, &1000);
    
    // Upgrade to version 2
    let new_wasm_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&new_wasm_hash);
    
    // Verify state preserved
    assert_eq!(client.version(), 2);
    assert_eq!(client.get_balance(&user).amount, 1000);
}
```

## Examples

### Example 1: Simple Token with Upgrade

```rust
// src/token_upgradeable/lib.rs
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    Version,
    Balance(Address),
    TotalSupply,
}

#[contract]
pub struct UpgradeableToken;

#[contractimpl]
impl UpgradeableToken {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Version, &1u32);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        admin.require_auth();

        let current_version: u32 = env.storage()
            .instance()
            .get(&DataKey::Version)
            .unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &(current_version + 1));

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        admin.require_auth();

        let balance = Self::balance_of(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to), &(balance + amount));

        let supply: i128 = env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + amount));
    }

    pub fn balance_of(env: Env, owner: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(owner))
            .unwrap_or(0)
    }
}
```

### Example 2: Staking Contract with Upgrade

```rust
// See src/staking/lib.rs for full implementation
// Key upgrade considerations:
// - Reward rate changes
// - Lock period adjustments
// - New reward calculation logic
// - Migration of existing stakes
```

### Example 3: Multi-Sig with Upgrade

```rust
// See src/escrow_multisig/lib.rs for full implementation
// Key upgrade considerations:
// - Threshold changes
// - Signer list updates
// - New approval mechanisms
```

## Best Practices Summary

### Do's ✅

1. **Use DataKey enums** for all storage organization
2. **Separate instance and persistent storage** appropriately
3. **Check initialization** before setting admin
4. **Require admin authorization** for upgrades
5. **Track version numbers** automatically
6. **Use parameterized keys** for address-based mappings
7. **Set TTL** on persistent storage
8. **Test storage compatibility** before upgrades
9. **Document storage layout** changes
10. **Use security registry** for pause functionality

### Don'ts ❌

1. **Don't use magic symbols** for storage keys
2. **Don't change storage layout** incompatibly
3. **Don't skip admin authorization** checks
4. **Don't forget version tracking**
5. **Don't use instance storage** for user data
6. **Don't ignore TTL** on persistent storage
7. **Don't upgrade without testing**
8. **Don't remove storage keys** in upgrades
9. **Don't change enum variant order**
10. **Don't upgrade without backup**

## Troubleshooting

### Issue: Upgrade Fails with "contract already initialized"

**Cause**: Trying to initialize an already initialized contract.

**Solution**: Check if admin is already set before initialization.

```rust
if env.storage().instance().has(&DataKey::Admin) {
    panic!("contract already initialized");
}
```

### Issue: Storage Data Lost After Upgrade

**Cause**: Incompatible storage layout change.

**Solution**: Maintain storage layout compatibility or implement migration.

### Issue: Version Not Incrementing

**Cause**: Version update logic missing or incorrect.

**Solution**: Ensure version is incremented before upgrade.

```rust
let current_version: u32 = env.storage()
    .instance()
    .get(&DataKey::Version)
    .unwrap_or(1);
env.storage()
    .instance()
    .set(&DataKey::Version, &(current_version + 1));
```

### Issue: High Storage Costs

**Cause**: Using instance storage for user data or not setting TTL.

**Solution**: Use persistent storage for user data and set appropriate TTL.

## References

- [Soroban Documentation](https://developers.stellar.org/docs/build/smart-contracts)
- [Soroban SDK Reference](https://soroban.stellar.org/docs/rust-soroban-sdk)
- [Stellar Contract Upgrade Guide](https://developers.stellar.org/docs/build/smart-contracts/tutorials/upgrade-contract)
- [AnchorPoint Repository](https://github.com/Lynndabel/AnchorPoint)

## Appendix

### Storage Type Comparison

| Aspect | Instance | Persistent | Temporary |
|--------|----------|------------|-----------|
| Lifetime | Contract lifetime | Indefinite (with TTL) | Single invocation |
| Cost | Low | Medium | Free |
| Use Case | Config, admin, version | User balances, stakes | Reentrancy guards |
| TTL Required | No | Yes | No |
| Access Speed | Fast | Medium | Fast |

### Common DataKey Patterns

```rust
// Configuration
DataKey::Admin
DataKey::Version
DataKey::Token
DataKey::RewardRate

// User Data
DataKey::Balance(Address)
DataKey::Stake(Address)
DataKey::Allowance(Address, Address)

// Token Data
DataKey::TotalSupply(u64)
DataKey::TokenMetadata(u64)

// State Flags
DataKey::Initialized
DataKey::Paused
```

### Upgrade Checklist

- [ ] Storage layout compatible
- [ ] Admin authorization verified
- [ ] Version tracking implemented
- [ ] Security registry integrated (optional)
- [ ] Tests updated
- [ ] Documentation updated
- [ ] Backup plan prepared
- [ ] Rollback strategy defined
- [ ] Audit trail maintained
- [ ] Governance approval obtained
