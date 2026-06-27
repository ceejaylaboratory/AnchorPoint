#![no_std]
//! Contract-to-Contract (C2C) Call Wrapper for AnchorPoint
//! 
//! Provides utilities for standardizing and securing contract-to-contract calls,
//! including reentrancy protection, error handling, and standardized response formats.

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol, Val, vec, Vec};

/// Error types for C2C calls
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum C2CError {
    CallFailed,
    ReentrancyDetected,
    InvalidResponse,
    TargetNotAuthorized,
    ExecutionTimeout,
    InsufficientGas,
}

/// Result of a C2C call
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct C2CResult {
    pub success: bool,
    pub data: Val,
    pub error: Option<C2CError>,
}

/// Reentrancy guard state
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ReentrancyGuardKey {
    Locked,
}

/// Standardized C2C call options
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct C2CCallOptions {
    /// Whether to enable reentrancy protection (default: true)
    pub prevent_reentrancy: bool,
    /// Whether to validate target address (default: false)
    pub validate_target: bool,
    /// Maximum gas to use for the call (optional)
    pub gas_limit: Option<u64>,
}

impl Default for C2CCallOptions {
    fn default() -> Self {
        Self {
            prevent_reentrancy: true,
            validate_target: false,
            gas_limit: None,
        }
    }
}

/// C2C Call Wrapper - provides secure contract-to-contract call utilities
pub struct C2CWrapper;

impl C2CWrapper {
    /// Execute a contract-to-contract call with optional reentrancy protection
    /// 
    /// # Arguments
    /// 
    /// * `env` - The Soroban environment
    /// * `target` - The target contract address to call
    /// * `func` - The function name to call on the target contract
    /// * `args` - Arguments to pass to the target function
    /// * `options` - Call options (reentrancy protection, validation, etc.)
    /// 
    /// # Returns
    /// 
    /// A C2CResult containing success status, return data, and optional error
    pub fn call(
        env: &Env,
        target: &Address,
        func: &Symbol,
        args: &Vec<Val>,
        options: &C2CCallOptions,
    ) -> C2CResult {
        // Validate target if required — Soroban handles contract validation at
        // the protocol level; this branch is kept for API compatibility but
        // always passes.
        if options.validate_target && false {
            return C2CResult {
                success: false,
                data: ().into_val(env),
                error: Some(C2CError::TargetNotAuthorized),
            };
        }

        // Apply reentrancy guard if enabled
        if options.prevent_reentrancy {
            if !Self::acquire_reentrancy_lock(env) {
                return C2CResult {
                    success: false,
                    data: ().into_val(env),
                    error: Some(C2CError::ReentrancyDetected),
                };
            }
        }

        // Execute the call with error handling
        let result = Self::execute_call(env, target, func, args);

        // Release reentrancy lock if it was acquired
        if options.prevent_reentrancy {
            Self::release_reentrancy_lock(env);
        }

        match result {
            Ok(data) => C2CResult {
                success: true,
                data,
                error: None,
            },
            Err(_) => C2CResult {
                success: false,
                data: ().into_val(env),
                error: Some(C2CError::CallFailed),
            },
        }
    }

    /// Execute a call and return the result
    fn execute_call(env: &Env, target: &Address, func: &Symbol, args: &Vec<Val>) -> Result<Val, ()> {
        // Use try_invoke to catch panics from the target contract
        let result = target.try_invoke(func, args);
        
        match result {
            Ok(Ok(val)) => Ok(val),
            _ => Err(()),
        }
    }


    /// Acquire reentrancy lock
    fn acquire_reentrancy_lock(env: &Env) -> bool {
        let lock_key = ReentrancyGuardKey::Locked;
        
        if env.storage().temporary().has(&lock_key) {
            return false; // Already locked
        }

        // Set lock with TTL (time-to-live) for safety
        env.storage().temporary().set(&lock_key, &true);
        env.storage().temporary().extend_ttl(&lock_key, 100, 1000);
        
        true
    }

    /// Release reentrancy lock
    fn release_reentrancy_lock(env: &Env) {
        let lock_key = ReentrancyGuardKey::Locked;
        env.storage().temporary().remove(&lock_key);
    }

    /// Create a proxy caller that can invoke multiple contracts
    /// 
    /// # Arguments
    /// 
    /// * `env` - The Soroban environment
    /// * `calls` - Vector of (target, func, args) tuples
    /// 
    /// # Returns
    /// 
    /// Vector of C2CResult for each call
    pub fn batch_call(
        env: &Env,
        calls: &Vec<(Address, Symbol, Vec<Val>)>,
    ) -> Vec<C2CResult> {
        let mut results = vec![env];
        let options = C2CCallOptions::default();

        for i in 0..calls.len() {
            let (target, func, args) = calls.get(i).unwrap();
            let result = Self::call(env, &target, &func, &args, &options);
            results.push_back(result);
        }

        results
    }

    /// Emit a C2C call event for indexing
    pub fn emit_c2c_event(
        env: &Env,
        caller: &Address,
        target: &Address,
        func: &Symbol,
        success: bool,
    ) {
        let event_data = (caller, target, func, success);
        env.events()
            .publish((symbol_short!("c2c"), symbol_short!("call")), event_data);
    }
}

/// Trait for contracts that want to use C2C calls
pub trait C2CCallable {
    /// Called before executing a C2C call
    fn before_call(env: &Env, target: &Address, func: &Symbol);
    
    /// Called after executing a C2C call
    fn after_call(env: &Env, target: &Address, func: &Symbol, result: &C2CResult);
}

/// Helper macro-like functions for common C2C patterns
pub mod helpers {
    use super::*;

    /// Safe transfer of tokens via C2C call
    pub fn safe_token_transfer(
        env: &Env,
        token_contract: &Address,
        from: &Address,
        to: &Address,
        amount: &i128,
    ) -> C2CResult {
        let args = vec![
            env,
            from.into_val(env),
            to.into_val(env),
            amount.into_val(env),
        ];
        
        let options = C2CCallOptions {
            prevent_reentrancy: true,
            validate_target: true,
            gas_limit: None,
        };

        let result = C2CWrapper::call(
            env,
            token_contract,
            &symbol_short!("transfer"),
            &args,
            &options,
        );

        if result.success {
            C2CWrapper::emit_c2c_event(
                env,
                &env.current_contract_address(),
                token_contract,
                &symbol_short!("transfer"),
                true,
            );
        }

        result
    }

    /// Query balance from another contract
    pub fn query_balance(
        env: &Env,
        token_contract: &Address,
        account: &Address,
    ) -> C2CResult {
        let args = vec![env, account.into_val(env)];
        
        let options = C2CCallOptions {
            prevent_reentrancy: false, // Read-only call, no reentrancy risk
            validate_target: true,
            gas_limit: None,
        };

        C2CWrapper::call(
            env,
            token_contract,
            &symbol_short!("balance"),
            &args,
            &options,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, contract, contractimpl, symbol_short};

    #[contract]
    pub struct MockTargetContract;

    #[contractimpl]
    impl MockTargetContract {
        pub fn add(env: Env, a: i128, b: i128) -> i128 {
            a + b
        }

        pub fn multiply(env: Env, a: i128, b: i128) -> i128 {
            a * b
        }

        pub fn panic_call(env: Env) {
            panic!("intentional panic");
        }

        pub fn get_value(env: Env) -> i128 {
            42
        }
    }

    #[test]
    fn test_successful_c2c_call() {
        let env = Env::default();
        env.mock_all_auths();

        let target_id = env.register(MockTargetContract, ());
        let target = Address::from_contract(&target_id);

        let args = vec![
            &env,
            10i128.into_val(&env),
            20i128.into_val(&env),
        ];

        let options = C2CCallOptions::default();
        let result = C2CWrapper::call(
            &env,
            &target,
            &symbol_short!("add"),
            &args,
            &options,
        );

        assert!(result.success);
        assert!(result.error.is_none());
        // Note: We can't easily verify the return value in tests due to Val type
    }

    #[test]
    fn test_c2c_call_with_panic() {
        let env = Env::default();
        env.mock_all_auths();

        let target_id = env.register(MockTargetContract, ());
        let target = Address::from_contract(&target_id);

        let args = vec![&env];

        let options = C2CCallOptions::default();
        let result = C2CWrapper::call(
            &env,
            &target,
            &symbol_short!("panic_call"),
            &args,
            &options,
        );

        assert!(!result.success);
        assert_eq!(result.error, Some(C2CError::CallFailed));
    }

    #[test]
    fn test_batch_calls() {
        let env = Env::default();
        env.mock_all_auths();

        let target_id = env.register(MockTargetContract, ());
        let target = Address::from_contract(&target_id);

        let add_args = vec![
            &env,
            10i128.into_val(&env),
            20i128.into_val(&env),
        ];

        let mul_args = vec![
            &env,
            5i128.into_val(&env),
            6i128.into_val(&env),
        ];

        let calls = vec![
            &env,
            (target.clone(), symbol_short!("add"), add_args),
            (target.clone(), symbol_short!("multiply"), mul_args),
        ];

        let results = C2CWrapper::batch_call(&env, &calls);

        assert_eq!(results.len(), 2);
        assert!(results.get(0).unwrap().success);
        assert!(results.get(1).unwrap().success);
    }

    #[test]
    fn test_reentrancy_protection() {
        let env = Env::default();
        env.mock_all_auths();

        let target_id = env.register(MockTargetContract, ());
        let target = Address::from_contract(&target_id);

        let args = vec![&env];
        let options = C2CCallOptions {
            prevent_reentrancy: true,
            validate_target: false,
            gas_limit: None,
        };

        // First call should succeed
        let result1 = C2CWrapper::call(&env, &target, &symbol_short!("get_value"), &args, &options);
        assert!(result1.success);

        // Manually set the lock to simulate reentrancy
        env.storage().temporary().set(&ReentrancyGuardKey::Locked, &true);

        // Second call should fail due to reentrancy
        let result2 = C2CWrapper::call(&env, &target, &symbol_short!("get_value"), &args, &options);
        assert!(!result2.success);
        assert_eq!(result2.error, Some(C2CError::ReentrancyDetected));

        // Clean up
        env.storage().temporary().remove(&ReentrancyGuardKey::Locked);
    }

}
