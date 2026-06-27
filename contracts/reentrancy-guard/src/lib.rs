//! # Reentrancy Protection Framework for Soroban Contracts
//!
//! This library provides a comprehensive reentrancy guard implementation for Stellar Soroban
//! smart contracts. It prevents recursive calls that could drain contract funds or cause
//! unexpected state changes.
//!
//! ## Features
//!
//! - **Reentrancy Detection**: Prevents recursive calls to protected functions
//! - **Call Stack Tracking**: Maintains a call stack in instance storage
//! - **Clear Error Codes**: Provides specific error codes for different violation types
//! - **Zero-Cost Abstraction**: Minimal overhead when not under attack
//! - **Easy Integration**: Simple trait-based API
//!
//! ## Usage
//!
//! ```rust,ignore
//! use reentrancy_guard::{ReentrancyGuard, ReentrancyError};
//! use soroban_sdk::{contract, contractimpl, Env, Address};
//!
//! #[contract]
//! pub struct MyContract;
//!
//! #[contractimpl]
//! impl MyContract {
//!     pub fn protected_function(env: Env, caller: Address) -> Result<(), ReentrancyError> {
//!         // Acquire the guard at the start of the function
//!         let _guard = ReentrancyGuard::new(&env)?;
//!         
//!         // Your function logic here
//!         // The guard is automatically released when it goes out of scope
//!         
//!         Ok(())
//!     }
//! }
//! ```

#![no_std]

use soroban_sdk::{contracttype, Env, Symbol};

/// Storage key for the reentrancy guard state
const REENTRANCY_KEY: Symbol = symbol_short!("REENTRY");

/// Maximum allowed call depth before considering it a potential attack
const MAX_CALL_DEPTH: u32 = 10;

/// Error codes for reentrancy violations
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReentrancyError {
    /// Attempted to enter a function that is already being executed
    ReentrantCall = 1,
    
    /// Call stack depth exceeded maximum allowed depth
    MaxDepthExceeded = 2,
    
    /// Guard was not properly released (internal error)
    GuardNotReleased = 3,
    
    /// Invalid guard state detected
    InvalidState = 4,
}

/// Internal state tracking for the reentrancy guard
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
struct GuardState {
    /// Whether a protected function is currently executing
    locked: bool,
    
    /// Current call depth
    depth: u32,
    
    /// Number of times the guard has been acquired
    entry_count: u64,
}

impl Default for GuardState {
    fn default() -> Self {
        Self {
            locked: false,
            depth: 0,
            entry_count: 0,
        }
    }
}

/// RAII guard for reentrancy protection
///
/// This guard automatically releases the lock when it goes out of scope,
/// ensuring that the protected function can be called again after completion.
///
/// # Example
///
/// ```rust,ignore
/// pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), ReentrancyError> {
///     let _guard = ReentrancyGuard::new(&env)?;
///     
///     // Protected code here
///     // Guard is automatically released when function returns
///     
///     Ok(())
/// }
/// ```
pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    /// Create a new reentrancy guard
    ///
    /// # Errors
    ///
    /// Returns `ReentrancyError::ReentrantCall` if the function is already being executed.
    /// Returns `ReentrancyError::MaxDepthExceeded` if the call depth exceeds the maximum.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let _guard = ReentrancyGuard::new(&env)?;
    /// ```
    pub fn new(env: &'a Env) -> Result<Self, ReentrancyError> {
        Self::acquire(env)?;
        Ok(Self { env })
    }

    /// Acquire the reentrancy lock
    fn acquire(env: &Env) -> Result<(), ReentrancyError> {
        let mut state = Self::get_state(env);

        // Check if already locked (reentrancy detected)
        if state.locked {
            return Err(ReentrancyError::ReentrantCall);
        }

        // Check call depth
        if state.depth >= MAX_CALL_DEPTH {
            return Err(ReentrancyError::MaxDepthExceeded);
        }

        // Acquire the lock
        state.locked = true;
        state.depth += 1;
        state.entry_count += 1;

        Self::set_state(env, &state);

        Ok(())
    }

    /// Release the reentrancy lock
    fn release(env: &Env) -> Result<(), ReentrancyError> {
        let mut state = Self::get_state(env);

        // Verify the guard is actually locked
        if !state.locked {
            return Err(ReentrancyError::GuardNotReleased);
        }

        // Verify depth is valid
        if state.depth == 0 {
            return Err(ReentrancyError::InvalidState);
        }

        // Release the lock
        state.locked = false;
        state.depth = state.depth.saturating_sub(1);

        Self::set_state(env, &state);

        Ok(())
    }

    /// Get the current guard state
    fn get_state(env: &Env) -> GuardState {
        env.storage()
            .instance()
            .get(&REENTRANCY_KEY)
            .unwrap_or_default()
    }

    /// Set the guard state
    fn set_state(env: &Env, state: &GuardState) {
        env.storage().instance().set(&REENTRANCY_KEY, state);
    }

    /// Check if a function is currently protected (for testing/debugging)
    pub fn is_locked(env: &Env) -> bool {
        Self::get_state(env).locked
    }

    /// Get the current call depth (for testing/debugging)
    pub fn current_depth(env: &Env) -> u32 {
        Self::get_state(env).depth
    }

    /// Get the total number of times the guard has been acquired (for metrics)
    pub fn entry_count(env: &Env) -> u64 {
        Self::get_state(env).entry_count
    }

    /// Reset the guard state (use with caution, mainly for testing)
    pub fn reset(env: &Env) {
        env.storage().instance().remove(&REENTRANCY_KEY);
    }
}

impl<'a> Drop for ReentrancyGuard<'a> {
    /// Automatically release the lock when the guard goes out of scope
    fn drop(&mut self) {
        // Ignore errors during drop - we can't panic in drop
        let _ = Self::release(self.env);
    }
}

/// Macro to easily add reentrancy protection to a function
///
/// # Example
///
/// ```rust,ignore
/// use reentrancy_guard::protected;
///
/// #[protected]
/// pub fn my_function(env: Env, amount: i128) -> i128 {
///     // Function body
///     amount * 2
/// }
/// ```
#[macro_export]
macro_rules! protected {
    (
        $(#[$attr:meta])*
        $vis:vis fn $name:ident($env:ident: Env $(, $param:ident: $param_ty:ty)*) -> $ret:ty $body:block
    ) => {
        $(#[$attr])*
        $vis fn $name($env: Env $(, $param: $param_ty)*) -> Result<$ret, ReentrancyError> {
            let _guard = ReentrancyGuard::new(&$env)?;
            Ok($body)
        }
    };
}

/// Helper trait for contracts that want to use reentrancy protection
pub trait ReentrancyProtected {
    /// Execute a function with reentrancy protection
    fn with_guard<F, T>(env: &Env, f: F) -> Result<T, ReentrancyError>
    where
        F: FnOnce() -> T,
    {
        let _guard = ReentrancyGuard::new(env)?;
        Ok(f())
    }
}

// Implement the trait for all types
impl<T> ReentrancyProtected for T {}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_basic_guard() {
        let env = Env::default();

        // Should be able to acquire guard
        assert!(!ReentrancyGuard::is_locked(&env));
        
        {
            let _guard = ReentrancyGuard::new(&env).unwrap();
            assert!(ReentrancyGuard::is_locked(&env));
            assert_eq!(ReentrancyGuard::current_depth(&env), 1);
        }

        // Guard should be released after scope
        assert!(!ReentrancyGuard::is_locked(&env));
        assert_eq!(ReentrancyGuard::current_depth(&env), 0);
    }

    #[test]
    fn test_reentrancy_detection() {
        let env = Env::default();

        let _guard1 = ReentrancyGuard::new(&env).unwrap();
        
        // Attempting to acquire again should fail
        let result = ReentrancyGuard::new(&env);
        assert_eq!(result, Err(ReentrancyError::ReentrantCall));
    }

    #[test]
    fn test_nested_calls_after_release() {
        let env = Env::default();

        // First call
        {
            let _guard = ReentrancyGuard::new(&env).unwrap();
            assert_eq!(ReentrancyGuard::current_depth(&env), 1);
        }

        // Second call after first is released
        {
            let _guard = ReentrancyGuard::new(&env).unwrap();
            assert_eq!(ReentrancyGuard::current_depth(&env), 1);
        }

        assert!(!ReentrancyGuard::is_locked(&env));
    }

    #[test]
    fn test_entry_count() {
        let env = Env::default();

        assert_eq!(ReentrancyGuard::entry_count(&env), 0);

        {
            let _guard = ReentrancyGuard::new(&env).unwrap();
            assert_eq!(ReentrancyGuard::entry_count(&env), 1);
        }

        {
            let _guard = ReentrancyGuard::new(&env).unwrap();
            assert_eq!(ReentrancyGuard::entry_count(&env), 2);
        }

        {
            let _guard = ReentrancyGuard::new(&env).unwrap();
            assert_eq!(ReentrancyGuard::entry_count(&env), 3);
        }
    }

    #[test]
    fn test_max_depth_protection() {
        let env = Env::default();

        // Manually set depth to max
        let mut state = GuardState::default();
        state.depth = MAX_CALL_DEPTH;
        env.storage().instance().set(&REENTRANCY_KEY, &state);

        // Should fail due to max depth
        let result = ReentrancyGuard::new(&env);
        assert_eq!(result, Err(ReentrancyError::MaxDepthExceeded));
    }

    #[test]
    fn test_reset() {
        let env = Env::default();

        {
            let _guard = ReentrancyGuard::new(&env).unwrap();
            assert!(ReentrancyGuard::is_locked(&env));
        }

        ReentrancyGuard::reset(&env);
        assert_eq!(ReentrancyGuard::entry_count(&env), 0);
        assert_eq!(ReentrancyGuard::current_depth(&env), 0);
    }

    #[test]
    fn test_with_guard_helper() {
        let env = Env::default();

        let result = <()>::with_guard(&env, || {
            assert!(ReentrancyGuard::is_locked(&env));
            42
        });

        assert_eq!(result, Ok(42));
        assert!(!ReentrancyGuard::is_locked(&env));
    }

    #[test]
    fn test_with_guard_reentrancy() {
        let env = Env::default();

        let result = <()>::with_guard(&env, || {
            // Try to acquire guard again inside protected code
            let inner_result = <()>::with_guard(&env, || 42);
            assert_eq!(inner_result, Err(ReentrancyError::ReentrantCall));
            100
        });

        assert_eq!(result, Ok(100));
    }
}
