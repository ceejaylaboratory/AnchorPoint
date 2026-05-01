# XLM Wrapper Contract

A specialized Soroban contract for wrapping native Stellar (XLM) into a Soroban-compatible token format (wXLM), enabling seamless integration with AMM and Lending modules.

## Overview

The XLM Wrapper Contract provides a 1:1 peg between native Stellar (XLM) and wrapped XLM (wXLM) tokens. This allows native XLM to be used in Soroban smart contracts, including AMM pools and lending protocols.

## Features

- **1:1 Peg**: Each wXLM token is backed by exactly 1 native XLM
- **SEP-41 Compliant**: Full implementation of the Soroban token standard
- **Deposit/Withdraw**: Seamlessly convert between native XLM and wXLM
- **AMM Integration**: Authorization hooks for AMM protocol interaction
- **Lending Integration**: Authorization hooks for lending/flash loan protocols
- **Emergency Controls**: Pause/unpause functionality for security
- **Operator Approvals**: Support for operator approvals (ERC-4626 style)

## Contract Architecture

### Core Functions

- `initialize(admin, name, symbol)`: Initialize the contract with admin and metadata
- `deposit(from, amount)`: Deposit native XLM to mint wXLM (1:1)
- `withdraw(from, amount)`: Burn wXLM to withdraw native XLM (1:1)

### SEP-41 Token Interface

- `transfer(from, to, amount)`: Transfer wXLM between addresses
- `approve(owner, spender, amount)`: Approve spender to transfer tokens
- `set_approval_for_all(owner, operator, approved)`: Set operator approval
- `transfer_from(spender, from, to, amount)`: Transfer from approved spender
- `burn(from, amount)`: Burn tokens (for liquidations)
- `balance_of(owner)`: Get token balance
- `allowance(owner, spender)`: Get allowance amount
- `total_supply()`: Get total token supply
- `decimals()`: Get token decimals (7 for XLM)
- `name()`: Get token name
- `symbol()`: Get token symbol

### Integration Hooks

#### AMM Integration
- `authorize_amm(admin, amm_address)`: Authorize an AMM contract
- `revoke_amm(admin, amm_address)`: Revoke AMM authorization
- `is_amm_authorized(address)`: Check AMM authorization status

#### Lending Integration
- `authorize_lending(admin, lending_address)`: Authorize a lending contract
- `revoke_lending(admin, lending_address)`: Revoke lending authorization
- `is_lending_authorized(address)`: Check lending authorization status

### Admin Functions

- `pause(admin)`: Pause deposits and withdrawals (emergency)
- `unpause(admin)`: Unpause the contract
- `is_paused()`: Check pause status

## Usage Example

### Deployment and Initialization

```rust
let admin = Address::generate(&env);
let contract_id = env.register_contract(None, XLMWrapper);
let client = XLMWrapperClient::new(&env, &contract_id);

client.initialize(
    &admin,
    &String::from_str(&env, "Wrapped XLM"),
    &String::from_str(&env, "wXLM"),
);
```

### Depositing XLM to Mint wXLM

```rust
let user = Address::generate(&env);
let amount = 1000_i128;

// Deposit native XLM to receive wXLM
client.deposit(&user, &amount);

// Check wXLM balance
let balance = client.balance_of(&user);
assert_eq!(balance, 1000);
```

### Withdrawing XLM by Burning wXLM

```rust
let user = Address::generate(&env);
let amount = 500_i128;

// Burn wXLM to receive native XLM
client.withdraw(&user, &amount);

// Check remaining wXLM balance
let balance = client.balance_of(&user);
```

### AMM Integration

```rust
let amm_address = Address::generate(&env);

// Authorize AMM contract
client.authorize_amm(&admin, &amm_address);

// Check authorization
assert!(client.is_amm_authorized(&amm_address));

// Now AMM can interact with wXLM tokens
```

### Lending Integration

```rust
let lending_address = Address::generate(&env);

// Authorize lending contract
client.authorize_lending(&admin, &lending_address);

// Check authorization
assert!(client.is_lending_authorized(&lending_address));

// Now lending protocol can use wXLM for collateral
```

## Integration with AMM Module

The wXLM token can be used directly in the AMM module as a standard SEP-41 token:

```rust
// Initialize AMM pool with wXLM and another token
let wxlm_address = env.current_contract_address();
let other_token = Address::generate(&env);

amm_client.initialize(&wxlm_address, &other_token);

// Add liquidity
amm_client.deposit(&user, &1000, &2000);

// Swap tokens
amm_client.swap(&user, &wxlm_address, &500, &450);
```

## Integration with Lending Module

The wXLM token can be used as collateral in lending protocols:

```rust
// Deposit wXLM as collateral
lending_client.deposit_collateral(&user, &wxlm_address, &1000);

// Borrow against wXLM collateral
lending_client.borrow(&user, &other_token, &500);

// In case of liquidation, burn wXLM
wxlm_client.burn(&liquidator, &100);
```

## Security Considerations

1. **1:1 Peg Enforcement**: The contract enforces a strict 1:1 ratio between deposited XLM and minted wXLM
2. **Authorization System**: Only authorized contracts can interact with AMM and lending protocols
3. **Emergency Pause**: Admin can pause deposits/withdrawals in emergencies
4. **Access Control**: Admin functions require admin authorization
5. **Reentrancy Protection**: The contract follows Soroban best practices to prevent reentrancy

## Testing

Run the test suite:

```bash
cd contracts/xlm_wrapper
cargo test
```

## Building

Build the contract:

```bash
cd contracts/xlm_wrapper
cargo build --target wasm32-unknown-unknown --release
```

## License

This contract is part of the AnchorPoint project.
