# Security Guide: Reentrancy Protection in Soroban

## Table of Contents

1. [Understanding Reentrancy Attacks](#understanding-reentrancy-attacks)
2. [How the Guard Works](#how-the-guard-works)
3. [Implementation Patterns](#implementation-patterns)
4. [Security Checklist](#security-checklist)
5. [Attack Scenarios](#attack-scenarios)
6. [Audit Guidelines](#audit-guidelines)

## Understanding Reentrancy Attacks

### What is a Reentrancy Attack?

A reentrancy attack occurs when a malicious contract calls back into the victim contract before the first invocation is complete, potentially:

- Draining funds
- Manipulating state
- Bypassing access controls
- Creating inconsistent state

### Classic Example: The DAO Hack

The infamous DAO hack in 2016 exploited a reentrancy vulnerability:

```rust
// VULNERABLE CODE (DO NOT USE)
pub fn withdraw(env: Env, to: Address, amount: i128) {
    let balance = get_balance(&env, &to);
    assert!(balance >= amount);
    
    // External call BEFORE state update
    transfer(&env, &to, amount);  // ← Attacker can re-enter here!
    
    // State update happens too late
    set_balance(&env, &to, balance - amount);
}
```

**Attack Flow:**
1. Attacker calls `withdraw(100)`
2. Contract checks balance (100 ≥ 100) ✓
3. Contract transfers 100 tokens
4. **Attacker's receive hook calls `withdraw(100)` again**
5. Contract checks balance (still 100!) ✓
6. Contract transfers another 100 tokens
7. Process repeats until contract is drained

### Soroban-Specific Considerations

While Soroban doesn't have fallback functions like Ethereum, reentrancy can still occur through:

1. **Token Callbacks**: SAC tokens may have hooks
2. **Cross-Contract Calls**: Calling other contracts that call back
3. **Delegated Operations**: Contracts acting on behalf of users

## How the Guard Works

### RAII Pattern

The guard uses Rust's RAII (Resource Acquisition Is Initialization) pattern:

```rust
pub fn protected_function(env: Env) -> Result<(), ReentrancyError> {
    let _guard = ReentrancyGuard::new(&env)?;  // Acquire lock
    
    // Function body
    
    // Lock automatically released when _guard goes out of scope
    Ok(())
}
```

### State Machine

```
┌─────────────┐
│  UNLOCKED   │
│ locked=false│
└──────┬──────┘
       │ new()
       ▼
┌─────────────┐
│   LOCKED    │
│ locked=true │
└──────┬──────┘
       │ drop()
       ▼
┌─────────────┐
│  UNLOCKED   │
│ locked=false│
└─────────────┘
```

### Storage Layout

```rust
Instance Storage:
  Key: "REENTRY"
  Value: GuardState {
    locked: bool,      // Is a function currently executing?
    depth: u32,        // Current call depth
    entry_count: u64,  // Total acquisitions (metrics)
  }
```

## Implementation Patterns

### Pattern 1: Basic Protection

```rust
pub fn transfer(env: Env, from: Address, to: Address, amount: i128) 
    -> Result<(), ReentrancyError> 
{
    let _guard = ReentrancyGuard::new(&env)?;
    
    from.require_auth();
    
    // Update state first
    let balance = get_balance(&env, &from);
    assert!(balance >= amount);
    set_balance(&env, &from, balance - amount);
    set_balance(&env, &to, get_balance(&env, &to) + amount);
    
    // External calls last
    emit_event(&env, "Transfer", from, to, amount);
    
    Ok(())
}
```

### Pattern 2: Checks-Effects-Interactions

```rust
pub fn withdraw(env: Env, user: Address, amount: i128) 
    -> Result<(), ReentrancyError> 
{
    let _guard = ReentrancyGuard::new(&env)?;
    
    // 1. CHECKS
    user.require_auth();
    let balance = get_balance(&env, &user);
    assert!(balance >= amount, "insufficient balance");
    
    // 2. EFFECTS (state changes)
    set_balance(&env, &user, balance - amount);
    
    // 3. INTERACTIONS (external calls)
    let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
    token::Client::new(&env, &token)
        .transfer(&env.current_contract_address(), &user, &amount);
    
    Ok(())
}
```

### Pattern 3: Batch Operations

```rust
pub fn batch_transfer(
    env: Env,
    from: Address,
    recipients: Vec<(Address, i128)>,
) -> Result<(), ReentrancyError> {
    // Single guard for entire batch
    let _guard = ReentrancyGuard::new(&env)?;
    
    from.require_auth();
    
    // Validate all transfers first
    let mut total = 0i128;
    for (_, amount) in recipients.iter() {
        total = total.checked_add(amount).unwrap();
    }
    
    let balance = get_balance(&env, &from);
    assert!(balance >= total);
    
    // Update state
    set_balance(&env, &from, balance - total);
    
    // Execute transfers
    for (to, amount) in recipients.iter() {
        set_balance(&env, &to, get_balance(&env, &to) + amount);
    }
    
    Ok(())
}
```

### Pattern 4: Conditional Protection

```rust
pub fn swap(
    env: Env,
    user: Address,
    token_in: Address,
    token_out: Address,
    amount: i128,
    protect: bool,  // Allow disabling for trusted calls
) -> Result<i128, ReentrancyError> {
    let _guard = if protect {
        Some(ReentrancyGuard::new(&env)?)
    } else {
        None
    };
    
    // Swap logic
    
    Ok(output_amount)
}
```

## Security Checklist

### Before Deployment

- [ ] All state-changing functions are protected
- [ ] Guards are acquired at function start
- [ ] State updates happen before external calls
- [ ] Error handling propagates reentrancy errors
- [ ] Read-only functions don't need guards
- [ ] Batch operations use single guard
- [ ] Tests cover reentrancy scenarios
- [ ] Code has been audited

### Code Review Checklist

- [ ] No external calls before state updates
- [ ] No unprotected loops with external calls
- [ ] No unprotected recursive functions
- [ ] Authorization checks before guard acquisition
- [ ] Proper error propagation
- [ ] No guard bypasses in error paths

### Testing Checklist

- [ ] Test normal operation
- [ ] Test reentrancy attempt (should fail)
- [ ] Test nested calls after release
- [ ] Test batch operations
- [ ] Test error conditions
- [ ] Test gas limits
- [ ] Test with malicious contracts

## Attack Scenarios

### Scenario 1: Direct Reentrancy

**Attack:**
```rust
// Attacker contract
pub fn attack(env: Env, victim: Address) {
    let victim_client = VictimClient::new(&env, &victim);
    victim_client.withdraw(&env.current_contract_address(), &1000);
}

// Attacker's token receive hook
pub fn on_receive(env: Env, from: Address, amount: i128) {
    // Try to withdraw again
    let victim_client = VictimClient::new(&env, &from);
    victim_client.withdraw(&env.current_contract_address(), &1000);
}
```

**Protection:**
```rust
pub fn withdraw(env: Env, to: Address, amount: i128) 
    -> Result<(), ReentrancyError> 
{
    let _guard = ReentrancyGuard::new(&env)?;  // ← Blocks reentrancy
    // ... rest of function
    Ok(())
}
```

### Scenario 2: Cross-Function Reentrancy

**Attack:**
```rust
// Attacker calls withdraw, which calls transfer internally
pub fn attack(env: Env, victim: Address) {
    let victim_client = VictimClient::new(&env, &victim);
    victim_client.withdraw(&env.current_contract_address(), &1000);
}

// During withdraw, attacker's hook calls deposit
pub fn on_receive(env: Env, from: Address, amount: i128) {
    let victim_client = VictimClient::new(&env, &from);
    victim_client.deposit(&env.current_contract_address(), &500);
}
```

**Protection:**
```rust
// Both functions protected by same guard
pub fn withdraw(env: Env, to: Address, amount: i128) 
    -> Result<(), ReentrancyError> 
{
    let _guard = ReentrancyGuard::new(&env)?;
    // ...
}

pub fn deposit(env: Env, from: Address, amount: i128) 
    -> Result<(), ReentrancyError> 
{
    let _guard = ReentrancyGuard::new(&env)?;  // ← Blocks cross-function reentrancy
    // ...
}
```

### Scenario 3: Read-Only Reentrancy

**Attack:**
```rust
// Attacker manipulates view during state change
pub fn attack(env: Env, victim: Address) {
    let victim_client = VictimClient::new(&env, &victim);
    victim_client.withdraw(&env.current_contract_address(), &1000);
}

pub fn on_receive(env: Env, from: Address, amount: i128) {
    let victim_client = VictimClient::new(&env, &from);
    // Read inconsistent state
    let balance = victim_client.get_balance(&env.current_contract_address());
    // Use this for malicious purposes
}
```

**Protection:**
```rust
// Option 1: Protect view functions (if needed)
pub fn get_balance(env: Env, addr: Address) 
    -> Result<i128, ReentrancyError> 
{
    let _guard = ReentrancyGuard::new(&env)?;
    Ok(Self::_get_balance(&env, &addr))
}

// Option 2: Use snapshots
pub fn withdraw(env: Env, to: Address, amount: i128) 
    -> Result<(), ReentrancyError> 
{
    let _guard = ReentrancyGuard::new(&env)?;
    
    // Take snapshot before external call
    let snapshot = Self::create_snapshot(&env);
    
    // External call
    transfer(&env, &to, amount);
    
    // Verify snapshot unchanged
    assert!(Self::verify_snapshot(&env, &snapshot));
    
    Ok(())
}
```

## Audit Guidelines

### For Auditors

When auditing contracts using this guard:

1. **Verify Guard Placement**
   - Guards should be at function start
   - No operations before guard acquisition
   - All state-changing functions protected

2. **Check Error Handling**
   - Reentrancy errors properly propagated
   - No error swallowing
   - Proper Result types

3. **Validate State Changes**
   - State updates before external calls
   - No state changes after external calls
   - Proper use of Checks-Effects-Interactions

4. **Test Coverage**
   - Reentrancy tests present
   - Edge cases covered
   - Malicious contract tests

5. **Performance Impact**
   - Guard overhead acceptable
   - No unnecessary guards
   - Proper guard scope

### Red Flags

🚩 External calls before state updates
🚩 Unprotected state-changing functions
🚩 Guards acquired after operations
🚩 Error handling that bypasses guards
🚩 Recursive functions without guards
🚩 Complex control flow with guards

### Green Flags

✅ Guards at function start
✅ State updates before external calls
✅ Comprehensive test coverage
✅ Clear error propagation
✅ Minimal guard scope
✅ Well-documented code

## Conclusion

The reentrancy guard provides robust protection against reentrancy attacks in Soroban contracts. By following the patterns and guidelines in this document, you can build secure contracts that protect user funds and maintain consistent state.

Remember:
- **Always use the guard for state-changing functions**
- **Update state before external calls**
- **Test thoroughly with malicious contracts**
- **Get your code audited**

Stay safe! 🛡️
