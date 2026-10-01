#![no_std]

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, token, Address, Env, Map,
    Vec,
};

fn calculate_fee(amount: i128, fee_bps: u32) -> i128 {
    // Fee math is shared by single and batch loans so both paths use identical rounding.
    amount
        .checked_mul(i128::from(fee_bps))
        .and_then(|value| value.checked_div(10_000))
        .expect("Fee calculation overflow")
}

fn checked_repayment_amount(balance: i128, fee: i128) -> i128 {
    // Repayment checks must trap on overflow instead of accepting an invalid balance target.
    balance
        .checked_add(fee)
        .expect("Repayment calculation overflow")
}

/// Storage keys for the flash loan provider
#[derive(Clone)]
#[contracttype]
enum DataKey {
    /// Fee basis points (e.g., 5 = 0.05%)
    FeeBps,
    /// Security registry address
    SecurityRegistry,
    /// Reentrancy lock flag guarding borrower callback execution
    ReentrancyLock,
    /// Liquidity provider reward pool address
    RewardPool,
}

/// Loan details for batch operations
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanDetail {
    pub token: Address,
    pub amount: i128,
    pub fee: i128,
}

/// Interface that a flash loan receiver must implement.
#[contractclient(name = "FlashLoanReceiverClient")]
pub trait FlashLoanReceiver {
    fn execute_loan(env: Env, token: Address, amount: i128, fee: i128);
}

/// Interface for batch flash loan receivers.
/// Allows borrowing multiple assets in a single atomic transaction.
#[contractclient(name = "FlashLoanBatchReceiverClient")]
pub trait FlashLoanBatchReceiver {
    /// Execute a batch flash loan with multiple assets.
    ///
    /// # Arguments
    /// * `loans` - Vector of LoanDetail containing token, amount, and fee for each loan.
    fn execute_batch_loan(env: Env, loans: Vec<LoanDetail>);
}

#[contract]
pub struct FlashLoanProvider;

#[allow(deprecated)]
#[contractimpl]
impl FlashLoanProvider {
    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env
            .storage()
            .instance()
            .has(&soroban_sdk::symbol_short!("sec_reg"))
        {
            panic!("already set");
        }
        env.storage()
            .instance()
            .set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    /// Set the fee basis points for flash loans.
    /// Default is 5 basis points (0.05%).
    pub fn set_fee_bps(env: Env, fee_bps: u32) {
        if fee_bps > 10000 {
            panic!("fee cannot exceed 100%");
        }
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
    }

    /// Get the current fee basis points.
    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(9)
    }

    pub fn set_reward_pool(env: Env, address: Address) {
        env.storage().instance().set(&DataKey::RewardPool, &address);
    }

    /// Acquire the reentrancy lock, trapping if a flash loan is already in progress.
    ///
    /// The lock is held across the untrusted borrower callback and only released
    /// after the post-callback repayment verification completes, so a malicious
    /// receiver cannot recursively re-enter `flash_loan`/`flash_loan_batch` and
    /// drain the pool.
    fn acquire_reentrancy_lock(env: &Env) {
        if env.storage().instance().has(&DataKey::ReentrancyLock) {
            panic!("Reentrancy detected: flash loan already in progress");
        }
        env.storage().instance().set(&DataKey::ReentrancyLock, &true);
    }

    /// Release the reentrancy lock once balance verification has completed.
    fn release_reentrancy_lock(env: &Env) {
        env.storage().instance().remove(&DataKey::ReentrancyLock);
    }

    /// Executes a flash loan for a single asset.
    ///
    /// # Arguments
    /// * `receiver` - The address of the contract that will receive the loan and execute the logic.
    /// * `token` - The address of the token to be lent.
    /// * `amount` - The amount of tokens to lend.
    pub fn flash_loan(env: Env, receiver: Address, token: Address, amount: i128) {
        // 0. Acquire the reentrancy lock before any external interaction.
        Self::acquire_reentrancy_lock(&env);

        // 1. Calculate the fee (e.g. default 5 bps = 0.05%, or configured fee_bps such as 9 bps = 0.09%)
        let fee_bps = Self::get_fee_bps(env.clone());
        let fee = calculate_fee(amount, fee_bps);

        // 2. Read vault balance prior to invoking borrower contract execution
        let token_client = token::Client::new(&env, &token);
        let balance_before = token_client.balance(&env.current_contract_address());

        // 3. Compute required return: original balance + (amount * fee_bps / 10000)
        let required_repayment = checked_repayment_amount(balance_before, fee);

        // 4. Transfer tokens to the receiver
        token_client.transfer(&env.current_contract_address(), &receiver, &amount);

        // 5. Invoke the receiver's execution logic (untrusted external call, lock held)
        let receiver_client = FlashLoanReceiverClient::new(&env, &receiver);
        receiver_client.execute_loan(&token, &amount, &fee);

        // 6. Assert post-execution balance is greater than or equal to required return
        let balance_after = token_client.balance(&env.current_contract_address());
        if balance_after < required_repayment {
            panic!("Flash loan not repaid with fee");
        }

        if let Some(reward_pool) = env.storage().instance().get::<_, Address>(&DataKey::RewardPool) {
            token_client.transfer(&env.current_contract_address(), &reward_pool, &fee);
        }

        // 7. Release the lock only after balance verification has completed.
        Self::release_reentrancy_lock(&env);

        // Topic: event name only; receiver + token (Addresses) + amounts in data.
        env.events()
            .publish((symbol_short!("flash_ln"),), (receiver, token, amount, fee));
    }

    /// Executes a flash loan for multiple distinct tokens in a single call.
    /// This enables complex arbitrage strategies across multiple token pairs.
    ///
    /// # Arguments
    /// * `receiver` - The address of the contract that will receive the loans and execute the logic.
    /// * `tokens` - Vector of token addresses to borrow.
    /// * `amounts` - Vector of amounts to borrow for each token (must match tokens length).
    ///
    /// # Example
    /// ```ignore
    /// let tokens = vec![&env, token_a, token_b, token_c];
    /// let amounts = vec![&env, 1000, 500, 250];
    /// provider.flash_loan_multi(&receiver, &tokens, &amounts);
    /// ```
    pub fn flash_loan_multi(env: Env, receiver: Address, tokens: Vec<Address>, amounts: Vec<i128>) {
        if tokens.is_empty() {
            panic!("cannot flash loan zero assets");
        }
        if tokens.len() != amounts.len() {
            panic!("tokens and amounts vectors must have equal length");
        }

        let fee_bps = Self::get_fee_bps(env.clone());
        let provider_address = env.current_contract_address();

        // 1. Calculate fees and check initial balances for all tokens
        let mut loan_details: Vec<LoanDetail> = Vec::new(&env);
        let mut required_repayments: Map<Address, i128> = Map::new(&env);

        for i in 0..tokens.len() {
            let token = tokens.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            let fee = calculate_fee(amount, fee_bps);

            let token_client = token::Client::new(&env, &token);
            let current_required = required_repayments
                .get(token.clone())
                .unwrap_or_else(|| token_client.balance(&provider_address));
            // Aggregate by token so duplicate-token batches must repay every fee.
            let expected_repayment = checked_repayment_amount(current_required, fee);

            required_repayments.set(token.clone(), expected_repayment);
            loan_details.push_back(LoanDetail {
                token: token.clone(),
                amount,
                fee,
            });
        }

        // 2. Transfer all tokens to the receiver
        for i in 0..tokens.len() {
            let token = tokens.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&provider_address, &receiver, &amount);
        }

        // 3. Invoke the receiver's batch execution logic
        let receiver_client = FlashLoanBatchReceiverClient::new(&env, &receiver);
        receiver_client.execute_batch_loan(&loan_details);

        // 4. Verify repayment for all tokens
        for i in 0..loan_details.len() {
            let loan = loan_details.get(i).unwrap();
            let token_client = token::Client::new(&env, &loan.token);
            let balance_after = token_client.balance(&provider_address);
            let expected_repayment = required_repayments.get(loan.token.clone()).unwrap();
            if balance_after < expected_repayment {
                panic!(
                    "Flash loan not repaid for token {:?}: expected {}, got {}",
                    loan.token, expected_repayment, balance_after
                );
            }
        }

        // 5. Emit batch event
        env.events()
            .publish((symbol_short!("fl_multi"), receiver), loan_details);
    }

    /// Executes a batch flash loan for multiple assets in a single atomic transaction.
    /// This enables complex arbitrage strategies across multiple token pairs.
    ///
    /// # Arguments
    /// * `receiver` - The address of the contract that will receive the loans and execute the logic.
    /// * `loans` - Vector of (token_address, amount) tuples for each asset to borrow.
    ///
    /// # Example
    /// ```ignore
    /// let loans = vec![
    ///     &env,
    ///     (token_a, 1000),
    ///     (token_b, 500),
    ///     (token_c, 250),
    /// ];
    /// provider.flash_loan_batch(&receiver, &loans);
    /// ```
    pub fn flash_loan_batch(env: Env, receiver: Address, loans: Vec<(Address, i128)>) {
        if loans.is_empty() {
            panic!("cannot flash loan zero assets");
        }

        // 0. Acquire the reentrancy lock before any external interaction.
        Self::acquire_reentrancy_lock(&env);

        let fee_bps = Self::get_fee_bps(env.clone());
        let provider_address = env.current_contract_address();

        // 1. Calculate fees and check initial balances for all tokens
        let mut loan_details: Vec<LoanDetail> = Vec::new(&env);
        let mut required_repayments: Map<Address, i128> = Map::new(&env);

        for i in 0..loans.len() {
            let (token, amount) = loans.get(i).unwrap();
            let fee = calculate_fee(amount, fee_bps);

            let token_client = token::Client::new(&env, &token);
            let current_required = required_repayments
                .get(token.clone())
                .unwrap_or_else(|| token_client.balance(&provider_address));
            // Aggregate by token so duplicate-token batches must repay every fee.
            let expected_repayment = checked_repayment_amount(current_required, fee);

            required_repayments.set(token.clone(), expected_repayment);
            loan_details.push_back(LoanDetail {
                token: token.clone(),
                amount,
                fee,
            });
        }

        // 2. Transfer all tokens to the receiver
        for i in 0..loans.len() {
            let (token, amount) = loans.get(i).unwrap();
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&provider_address, &receiver, &amount);
        }

        // 3. Invoke the receiver's batch execution logic (untrusted external call, lock held)
        let receiver_client = FlashLoanBatchReceiverClient::new(&env, &receiver);
        receiver_client.execute_batch_loan(&loan_details);

        // 4. Verify repayment for all tokens
        for i in 0..loan_details.len() {
            let loan = loan_details.get(i).unwrap();
            let token_client = token::Client::new(&env, &loan.token);
            let balance_after = token_client.balance(&provider_address);
            let expected_repayment = required_repayments.get(loan.token.clone()).unwrap();
            if balance_after < expected_repayment {
                panic!(
                    "Flash loan not repaid for token {:?}: expected {}, got {}",
                    loan.token, expected_repayment, balance_after
                );
            }
            if let Some(reward_pool) = env.storage().instance().get::<_, Address>(&DataKey::RewardPool) {
                token_client.transfer(&provider_address, &reward_pool, &loan.fee);
            }
        }

        // 5. Release the lock only after balance verification has completed.
        Self::release_reentrancy_lock(&env);

        // 6. Emit batch event
        env.events()
            .publish((symbol_short!("fl_batch"), receiver), loan_details);
    }
}

mod tests;

#[allow(unexpected_cfgs)]
#[cfg(kani)]
mod verification;
