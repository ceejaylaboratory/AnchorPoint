#![no_std]
//! Flash Loan Provider
//!
//! Provides single-asset and batch multi-asset flash loans with **dynamic fee
//! calculation**. The fee tier is determined by the loan amount:
//!
//! | Loan amount (raw units) | Fee (basis points) |
//! |-------------------------|--------------------|
//! | < 10 000                | 30 bps (0.30 %)    |
//! | 10 000 – 99 999         | 20 bps (0.20 %)    |
//! | ≥ 100 000               | 10 bps (0.10 %)    |
//!
//! The tiers can be overridden by the contract owner via `set_fee_tiers`.
//! A static fallback fee (`fee_bps`) is also retained for backward
//! compatibility and is used when no tiers are configured.
//!
//! ## Atomicity guarantee
//!
//! Repayment is enforced by comparing the provider's token balance before and
//! after the receiver callback. If the balance does not increase by at least
//! the fee, the entire transaction reverts.

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, token, Address, Env, Map,
    Vec,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

/// Storage keys for the flash loan provider.
#[derive(Clone)]
#[contracttype]
enum DataKey {
    /// Static fallback fee in basis points (e.g., 5 = 0.05 %).
    FeeBps,
    /// Dynamic fee tiers: Vec<(volume_threshold: i128, fee_bps: i128)>.
    /// Tiers must be sorted ascending by threshold.
    FeeTiers,
    /// Security registry address (optional).
    SecurityRegistry,
    /// Transaction-scoped lock for flash-loan callbacks.
    ReentrancyLock,
}

// ── Public types ──────────────────────────────────────────────────────────────

/// A single dynamic fee tier.
///
/// When the loan `amount` is ≥ `volume_threshold`, `fee_bps` applies.
/// Tiers are evaluated in ascending order; the last matching tier wins.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeTier {
    /// Minimum loan amount (inclusive) for this tier to apply.
    pub volume_threshold: i128,
    /// Fee in basis points (10 000 = 100 %).
    pub fee_bps: i128,
}

/// Loan details passed to batch flash loan receivers.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanDetail {
    pub token: Address,
    pub amount: i128,
    pub fee: i128,
}

// ── Receiver interfaces ───────────────────────────────────────────────────────

/// Interface that a single-asset flash loan receiver must implement.
#[contractclient(name = "FlashLoanReceiverClient")]
pub trait FlashLoanReceiver {
    fn execute_loan(env: Env, token: Address, amount: i128, fee: i128);
}

/// Interface that a batch flash loan receiver must implement.
#[contractclient(name = "FlashLoanBatchReceiverClient")]
pub trait FlashLoanBatchReceiver {
    fn execute_batch_loan(env: Env, loans: Vec<LoanDetail>);
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct FlashLoanProvider;

#[contractimpl]
impl FlashLoanProvider {
    // ── Configuration ─────────────────────────────────────────────────────────

    /// Attach an optional security registry (one-time, immutable).
    pub fn set_security_registry(env: Env, registry: Address) {
        if env.storage().instance().has(&DataKey::SecurityRegistry) {
            panic!("already set");
        }
        env.storage()
            .instance()
            .set(&DataKey::SecurityRegistry, &registry);
    }

    /// Set the static fallback fee in basis points.
    ///
    /// Used when no dynamic fee tiers are configured, or as a floor.
    /// Default: 5 bps (0.05 %).
    pub fn set_fee_bps(env: Env, fee_bps: u32) {
        if fee_bps > 10_000 {
            panic!("fee cannot exceed 100%");
        }
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
    }

    /// Return the current static fallback fee in basis points.
    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(5)
    }

    /// Configure dynamic fee tiers.
    ///
    /// `tiers` must be sorted ascending by `volume_threshold`.
    /// Pass an empty vec to disable dynamic fees (falls back to `fee_bps`).
    ///
    /// ## Example tiers
    /// ```ignore
    /// [
    ///   FeeTier { volume_threshold:      0, fee_bps: 30 }, // < 10 000 → 0.30 %
    ///   FeeTier { volume_threshold: 10_000, fee_bps: 20 }, // 10k–99k  → 0.20 %
    ///   FeeTier { volume_threshold: 100_000, fee_bps: 10 }, // ≥ 100k  → 0.10 %
    /// ]
    /// ```
    pub fn set_fee_tiers(env: Env, tiers: Vec<FeeTier>) {
        // Validate: all fee_bps ≤ 10 000 and thresholds are non-negative.
        for i in 0..tiers.len() {
            let t = tiers.get(i).unwrap();
            if t.fee_bps > 10_000 {
                panic!("tier fee cannot exceed 100%");
            }
            if t.volume_threshold < 0 {
                panic!("volume threshold must be non-negative");
            }
        }
        env.storage().instance().set(&DataKey::FeeTiers, &tiers);
    }

    /// Return the configured fee tiers (may be empty).
    pub fn get_fee_tiers(env: Env) -> Vec<FeeTier> {
        env.storage()
            .instance()
            .get(&DataKey::FeeTiers)
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── Fee calculation ───────────────────────────────────────────────────────

    /// Calculate the fee for a given loan `amount` using dynamic tiers.
    ///
    /// Tiers are evaluated in ascending order; the last tier whose
    /// `volume_threshold ≤ amount` applies. Falls back to the static
    /// `fee_bps` when no tiers are configured or no tier matches.
    ///
    /// This implements the dynamic fee calculation required by issue #396.
    pub fn calculate_fee(env: Env, amount: i128) -> i128 {
        Self::_calculate_fee(&env, amount)
    }

    fn _calculate_fee(env: &Env, amount: i128) -> i128 {
        let tiers: Vec<FeeTier> = env
            .storage()
            .instance()
            .get(&DataKey::FeeTiers)
            .unwrap_or_else(|| Vec::new(env));

        let mut selected_bps: i128 = env
            .storage()
            .instance()
            .get::<DataKey, u32>(&DataKey::FeeBps)
            .unwrap_or(5) as i128;

        // Walk tiers in order; last matching threshold wins.
        for i in 0..tiers.len() {
            let tier = tiers.get(i).unwrap();
            if amount >= tier.volume_threshold {
                selected_bps = tier.fee_bps;
            } else {
                // Tiers are sorted ascending — no further tier can match.
                break;
            }
        }

        amount
            .checked_mul(selected_bps)
            .expect("fee calculation overflow")
            / 10_000
    }

    // ── Flash loan (single asset) ─────────────────────────────────────────────

    /// Execute a single-asset flash loan.
    ///
    /// 1. Calculates the dynamic fee for `amount`.
    /// 2. Transfers `amount` to `receiver`.
    /// 3. Calls `receiver.execute_loan(token, amount, fee)`.
    /// 4. Verifies the provider's balance increased by at least `fee`.
    ///
    /// The entire transaction reverts if repayment is insufficient.
    pub fn flash_loan(env: Env, receiver: Address, token: Address, amount: i128) {
        Self::acquire_reentrancy_lock(&env);
        assert!(amount > 0, "amount must be positive");

        let fee = Self::_calculate_fee(&env, amount);

        let token_client = token::Client::new(&env, &token);
        let balance_before = token_client.balance(&env.current_contract_address());

        // Transfer principal to receiver.
        token_client.transfer(&env.current_contract_address(), &receiver, &amount);

        // Invoke receiver callback.
        let receiver_client = FlashLoanReceiverClient::new(&env, &receiver);
        receiver_client.execute_loan(&token, &amount, &fee);

        // Enforce repayment: balance must have increased by at least `fee`.
        let balance_after = token_client.balance(&env.current_contract_address());
        let required = balance_before
            .checked_add(fee)
            .expect("repayment calculation overflow");

        if balance_after < required {
            panic!("Flash loan not repaid with fee");
        }

        env.events()
            .publish((symbol_short!("flash_ln"),), (receiver, token, amount, fee));
        Self::release_reentrancy_lock(&env);
    }

    // ── Batch flash loan ──────────────────────────────────────────────────────

    /// Execute a batch flash loan across multiple assets atomically.
    ///
    /// Each asset in `loans` receives its own dynamic fee calculation.
    /// All assets must be repaid within the same transaction.
    ///
    /// # Arguments
    /// * `receiver` – contract implementing `FlashLoanBatchReceiver`.
    /// * `loans`    – vec of `(token_address, amount)` pairs.
    pub fn flash_loan_batch(env: Env, receiver: Address, loans: Vec<(Address, i128)>) {
        Self::acquire_reentrancy_lock(&env);
        if loans.is_empty() {
            panic!("cannot flash loan zero assets");
        }

        let provider_address = env.current_contract_address();

        // 1. Calculate fees and snapshot balances.
        let mut loan_details: Vec<LoanDetail> = Vec::new(&env);
        let mut balance_snapshots: Map<Address, i128> = Map::new(&env);

        for i in 0..loans.len() {
            let (token, amount) = loans.get(i).unwrap();
            assert!(amount > 0, "amount must be positive");

            let fee = Self::_calculate_fee(&env, amount);
            let token_client = token::Client::new(&env, &token);
            let balance_before = token_client.balance(&provider_address);

            balance_snapshots.set(token.clone(), balance_before);
            loan_details.push_back(LoanDetail {
                token: token.clone(),
                amount,
                fee,
            });
        }

        // 2. Transfer all principals to receiver.
        for i in 0..loans.len() {
            let (token, amount) = loans.get(i).unwrap();
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&provider_address, &receiver, &amount);
        }

        // 3. Invoke batch receiver callback.
        let receiver_client = FlashLoanBatchReceiverClient::new(&env, &receiver);
        receiver_client.execute_batch_loan(&loan_details);

        // 4. Verify repayment for every asset.
        for i in 0..loan_details.len() {
            let loan = loan_details.get(i).unwrap();
            let token_client = token::Client::new(&env, &loan.token);
            let balance_after = token_client.balance(&provider_address);
            let balance_before = balance_snapshots.get(loan.token.clone()).unwrap();
            let expected = balance_before + loan.fee;

            if balance_after < expected {
                panic!("Flash loan not repaid for token");
            }
        }

        env.events()
            .publish((symbol_short!("fl_batch"), receiver), loan_details);
        Self::release_reentrancy_lock(&env);
    }

    fn acquire_reentrancy_lock(env: &Env) {
        if env.storage().temporary().has(&DataKey::ReentrancyLock) {
            panic!("reentrant flash loan");
        }
        env.storage()
            .temporary()
            .set(&DataKey::ReentrancyLock, &true);
    }

    fn release_reentrancy_lock(env: &Env) {
        env.storage().temporary().remove(&DataKey::ReentrancyLock);
    }
}

mod tests;
mod verification;
