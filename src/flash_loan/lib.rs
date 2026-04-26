#![no_std]

use soroban_sdk::{contract, contractclient, contractimpl, contracttype, symbol_short, token, Address, Env, Vec, Map};

/// Storage keys for the flash loan provider
#[derive(Clone)]
#[contracttype]
enum DataKey {
    /// Fee basis points (e.g., 5 = 0.05%)
    FeeBps,
    /// Security registry address
    SecurityRegistry,
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

#[contractimpl]
impl FlashLoanProvider {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
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
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(5)
    }

    /// Executes a flash loan for a single asset.
    ///
    /// # Arguments
    /// * `receiver` - The address of the contract that will receive the loan and execute the logic.
    /// * `token` - The address of the token to be lent.
    /// * `amount` - The amount of tokens to lend.
    pub fn flash_loan(env: Env, receiver: Address, token: Address, amount: i128) {
        // 1. Calculate the fee (default 5 basis points = 0.05%)
        let fee_bps = Self::get_fee_bps(env.clone());
        let fee = amount * fee_bps as i128 / 10000;

        // 2. Initial balance check
        let token_client = token::Client::new(&env, &token);
        let balance_before = token_client.balance(&env.current_contract_address());

        // 3. Transfer tokens to the receiver
        token_client.transfer(&env.current_contract_address(), &receiver, &amount);

        // 4. Invoke the receiver's execution logic
        let receiver_client = FlashLoanReceiverClient::new(&env, &receiver);
        receiver_client.execute_loan(&token, &amount, &fee);

        // 5. Verify repayment
        let balance_after = token_client.balance(&env.current_contract_address());

        if balance_after < balance_before + fee {
            panic!("Flash loan not repaid with fee");
        }

        // 6. Emit event
        env.events()
            .publish((symbol_short!("flash_ln"), receiver, token), (amount, fee));
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

        let fee_bps = Self::get_fee_bps(env.clone());
        let provider_address = env.current_contract_address();

        // 1. Calculate fees and check initial balances for all tokens
        let mut loan_details: Vec<LoanDetail> = Vec::new(&env);
        let mut balance_checks: Map<Address, i128> = Map::new(&env);

        for i in 0..loans.len() {
            let (token, amount) = loans.get(i).unwrap();
            let fee = amount * fee_bps as i128 / 10000;

            let token_client = token::Client::new(&env, &token);
            let balance_before = token_client.balance(&provider_address);

            balance_checks.set(token.clone(), balance_before);
            loan_details.push_back(LoanDetail {
                token: token.clone(),
                amount: *amount,
                fee,
            });
        }

        // 2. Transfer all tokens to the receiver
        for i in 0..loans.len() {
            let (token, amount) = loans.get(i).unwrap();
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&provider_address, &receiver, amount);
        }

        // 3. Invoke the receiver's batch execution logic
        let receiver_client = FlashLoanBatchReceiverClient::new(&env, &receiver);
        receiver_client.execute_batch_loan(&loan_details);

        // 4. Verify repayment for all tokens
        for i in 0..loan_details.len() {
            let loan = loan_details.get(i).unwrap();
            let token_client = token::Client::new(&env, &loan.token);
            let balance_after = token_client.balance(&provider_address);
            let balance_before = balance_checks.get(loan.token).unwrap();

            let expected_repayment = balance_before + loan.fee;
            if balance_after < expected_repayment {
                panic!(
                    "Flash loan not repaid for token {:?}: expected {}, got {}",
                    loan.token,
                    expected_repayment,
                    balance_after
                );
            }
        }

        // 5. Emit batch event
        env.events()
            .publish((symbol_short!("flash_batch"), receiver), loan_details);
    }
}

mod tests;
