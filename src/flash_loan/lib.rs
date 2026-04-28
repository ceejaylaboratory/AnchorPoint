#![no_std]

use soroban_sdk::{contract, contractclient, contractimpl, symbol_short, token, Address, Env};

/// Interface that a flash loan receiver must implement.
#[contractclient(name = "FlashLoanReceiverClient")]
pub trait FlashLoanReceiver {
    fn execute_loan(env: Env, token: Address, amount: i128, fee: i128);
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

    /// Executes a flash loan.
    ///
    /// # Arguments
    /// * `receiver` - The address of the contract that will receive the loan and execute the logic.
    /// * `token` - The address of the token to be lent.
    /// * `amount` - The amount of tokens to lend.
    pub fn flash_loan(env: Env, receiver: Address, token: Address, amount: i128) {
        // 1. Calculate the fee (5 basis points = 0.05%)
        // fee = amount * 5 / 10000
        let fee = amount.checked_mul(5).and_then(|a| a.checked_div(10000)).expect("Fee calculation overflow");
        
        // 2. Initial balance check
        let token_client = token::Client::new(&env, &token);
        let balance_before = token_client.balance(&env.current_contract_address());

        // 3. Transfer tokens to the receiver
        token_client.transfer(&env.current_contract_address(), &receiver, &amount);

        // 4. Invoke the receiver's execution logic
        let receiver_client = FlashLoanReceiverClient::new(&env, &receiver);
        receiver_client.execute_loan(&token, &amount, &fee);

        // 5. Verify repayment
        // This ensures atomic repayment enforcement. If the balance check fails, the 
        // whole transaction reverts, ensuring the loan is only successful if repaid.
        // Soroban's call stack management and the lack of contract state in this provider
        // make it naturally resistant to reentrancy attacks.
        let balance_after = token_client.balance(&env.current_contract_address());
        
        let required_repayment = balance_before.checked_add(fee).expect("Repayment calculation overflow");
        if balance_after < required_repayment {
            panic!("Flash loan not repaid with fee");
        }

        // 6. Emit event
        env.events()
            .publish((symbol_short!("flash_ln"), receiver, token), (amount, fee));
    }
}

mod tests;
mod verification;
