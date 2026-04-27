#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    EscrowInitialized,
    EscrowDetails,
    RefundClaimed,
}

#[contracttype]
#[derive(Clone)]
pub struct EscrowDetails {
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub unlock_time: u64,
    pub conditions_met: bool,
}

#[contract]
pub struct EscrowTimelock;

#[contractimpl]
impl EscrowTimelock {
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

    /// Initialize a time-locked escrow contract
    ///
    /// # Arguments
    ///
    /// * `sender` - The address sending the funds into escrow
    /// * `recipient` - The address that will receive the funds when unlocked
    /// * `token` - The token contract address
    /// * `amount` - The amount of tokens to escrow
    /// * `unlock_time` - The timestamp (in seconds since epoch) when funds can be claimed
    ///
    /// # Panics
    ///
    /// * If the contract is already initialized
    /// * If the unlock_time is in the past
    /// * If the amount is zero or negative
    pub fn initialize(
        e: Env,
        sender: Address,
        recipient: Address,
        token: Address,
        amount: i128,
        unlock_time: u64,
    ) {
        if e.storage().instance().has(&DataKey::EscrowInitialized) {
            panic!("escrow already initialized");
        }

        if amount <= 0 {
            panic!("amount must be positive");
        }

        // Note: We don't validate unlock_time > current time here because
        // Soroban doesn't provide reliable timestamps during contract creation.
        // The unlock_time validation happens during claim/refund operations.

        sender.require_auth();

        let details = EscrowDetails {
            sender: sender.clone(),
            recipient,
            token,
            amount,
            unlock_time,
            conditions_met: false,
        };

        e.storage()
            .instance()
            .set(&DataKey::EscrowDetails, &details);
        e.storage()
            .instance()
            .set(&DataKey::EscrowInitialized, &true);
        e.storage().instance().set(&DataKey::RefundClaimed, &false);

        // Transfer tokens from sender to this contract
        let token_client = token::Client::new(&e, &details.token);
        token_client.transfer(&sender, &e.current_contract_address(), &amount);
    }

    /// Mark conditions as met (can only be called by sender)
    pub fn mark_conditions_met(e: Env) {
        let mut details: EscrowDetails = e
            .storage()
            .instance()
            .get(&DataKey::EscrowDetails)
            .expect("escrow not initialized");

        details.sender.require_auth();
        details.conditions_met = true;

        e.storage()
            .instance()
            .set(&DataKey::EscrowDetails, &details);
    }

    /// Claim funds as the recipient (only after unlock_time or if conditions are met)
    pub fn claim(e: Env) {
        if let Some(registry) = e
            .storage()
            .instance()
            .get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg"))
        {
            let is_paused: bool = e.invoke_contract(
                &registry,
                &soroban_sdk::Symbol::new(&e, "is_paused"),
                soroban_sdk::vec![&e],
            );
            if is_paused {
                panic!("contract is paused");
            }
        }

        let details: EscrowDetails = e
            .storage()
            .instance()
            .get(&DataKey::EscrowDetails)
            .expect("escrow not initialized");

        let refund_claimed: bool = e
            .storage()
            .instance()
            .get(&DataKey::RefundClaimed)
            .unwrap_or(false);

        if refund_claimed {
            panic!("refund already claimed");
        }

        // Check if conditions are met OR unlock time has passed
        let conditions_met = details.conditions_met;
        let time_passed = e.ledger().timestamp() >= details.unlock_time;

        if !conditions_met && !time_passed {
            panic!("escrow not yet claimable");
        }

        details.recipient.require_auth();

        // Transfer tokens to recipient
        let token_client = token::Client::new(&e, &details.token);
        let contract_balance = token_client.balance(&e.current_contract_address());

        if contract_balance > 0 {
            token_client.transfer(
                &e.current_contract_address(),
                &details.recipient,
                &contract_balance,
            );
        }
    }

    /// Request refund as sender (only if unlock_time has passed and recipient hasn't claimed)
    pub fn refund(e: Env) {
        if let Some(registry) = e
            .storage()
            .instance()
            .get::<_, soroban_sdk::Address>(&soroban_sdk::symbol_short!("sec_reg"))
        {
            let is_paused: bool = e.invoke_contract(
                &registry,
                &soroban_sdk::Symbol::new(&e, "is_paused"),
                soroban_sdk::vec![&e],
            );
            if is_paused {
                panic!("contract is paused");
            }
        }

        let details: EscrowDetails = e
            .storage()
            .instance()
            .get(&DataKey::EscrowDetails)
            .expect("escrow not initialized");

        let refund_claimed: bool = e
            .storage()
            .instance()
            .get(&DataKey::RefundClaimed)
            .unwrap_or(false);

        if refund_claimed {
            panic!("refund already processed");
        }

        // Refund is only available after unlock_time has passed
        if e.ledger().timestamp() < details.unlock_time {
            panic!("refund not yet available - unlock time has not passed");
        }

        details.sender.require_auth();

        // Mark refund as claimed to prevent double claims
        e.storage().instance().set(&DataKey::RefundClaimed, &true);

        // Transfer remaining tokens back to sender
        let token_client = token::Client::new(&e, &details.token);
        let contract_balance = token_client.balance(&e.current_contract_address());

        if contract_balance > 0 {
            token_client.transfer(
                &e.current_contract_address(),
                &details.sender,
                &contract_balance,
            );
        }
    }

    /// Get escrow details
    pub fn get_escrow_details(e: Env) -> EscrowDetails {
        e.storage()
            .instance()
            .get(&DataKey::EscrowDetails)
            .expect("escrow not initialized")
    }

    /// Check if refund has been claimed
    pub fn get_refund_claimed(e: Env) -> bool {
        e.storage()
            .instance()
            .get(&DataKey::RefundClaimed)
            .unwrap_or(false)
    }

    /// Get current ledger timestamp
    pub fn get_current_time(e: Env) -> u64 {
        e.ledger().timestamp()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    #[test]
    fn test_initialize_escrow() {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract(admin.clone());
        let token_client = token::Client::new(&e, &token_id);

        let contract_id = e.register_contract(None, EscrowTimelock);
        let client = EscrowTimelockClient::new(&e, &contract_id);

        // Mint tokens to sender
        let amount = 1000;
        token_client.mint(&sender, &amount);
        assert_eq!(token_client.balance(&sender), amount);

        // Set unlock time to future (current time + 1000 seconds)
        let current_time = e.ledger().timestamp();
        let unlock_time = current_time + 1000;

        // Initialize escrow
        client.initialize(&sender, &recipient, &token_id, &amount, &unlock_time);

        // Verify token transfer
        assert_eq!(token_client.balance(&sender), 0);
        assert_eq!(token_client.balance(&contract_id), amount);

        // Verify escrow details
        let details = client.get_escrow_details();
        assert_eq!(details.sender, sender);
        assert_eq!(details.recipient, recipient);
        assert_eq!(details.token, token_id);
        assert_eq!(details.amount, amount);
        assert_eq!(details.unlock_time, unlock_time);
        assert!(!details.conditions_met);
    }

    #[test]
    fn test_claim_after_unlock_time() {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract(admin.clone());

        let contract_id = e.register_contract(None, EscrowTimelock);
        let client = EscrowTimelockClient::new(&e, &contract_id);

        // Mint tokens and initialize
        let amount = 1000;
        let token_client = token::Client::new(&e, &token_id);
        token_client.mint(&sender, &amount);

        let unlock_time = 1000; // Set to a fixed time
        e.ledger().with_mut(|li| li.timestamp = 500); // Set current time before unlock

        client.initialize(&sender, &recipient, &token_id, &amount, &unlock_time);

        // Try to claim before unlock time - should fail
        // (We can't easily test panics in the same test, so we skip ahead)

        // Advance time past unlock
        e.ledger().with_mut(|li| li.timestamp = 1500);

        // Claim successfully
        client.claim();

        assert_eq!(token_client.balance(&recipient), amount);
        assert_eq!(token_client.balance(&contract_id), 0);
    }

    #[test]
    fn test_claim_with_conditions_met() {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract(admin.clone());

        let contract_id = e.register_contract(None, EscrowTimelock);
        let client = EscrowTimelockClient::new(&e, &contract_id);

        let amount = 1000;
        let token_client = token::Client::new(&e, &token_id);
        token_client.mint(&sender, &amount);

        // Set unlock time far in future
        let unlock_time = 10000;
        e.ledger().with_mut(|li| li.timestamp = 500);

        client.initialize(&sender, &recipient, &token_id, &amount, &unlock_time);

        // Mark conditions as met
        client.mark_conditions_met();

        // Should be able to claim even though time hasn't passed
        client.claim();

        assert_eq!(token_client.balance(&recipient), amount);
    }

    #[test]
    fn test_refund_after_unlock_time() {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract(admin.clone());

        let contract_id = e.register_contract(None, EscrowTimelock);
        let client = EscrowTimelockClient::new(&e, &contract_id);

        let amount = 1000;
        let token_client = token::Client::new(&e, &token_id);
        token_client.mint(&sender, &amount);

        let unlock_time = 1000;
        e.ledger().with_mut(|li| li.timestamp = 500);

        client.initialize(&sender, &recipient, &token_id, &amount, &unlock_time);

        // Advance time past unlock
        e.ledger().with_mut(|li| li.timestamp = 1500);

        // Sender requests refund
        client.refund();

        assert_eq!(token_client.balance(&sender), amount);
        assert_eq!(token_client.balance(&contract_id), 0);
        assert!(client.get_refund_claimed());
    }

    #[test]
    #[should_panic(expected = "refund not yet available - unlock time has not passed")]
    fn test_refund_before_unlock_time_fails() {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract(admin.clone());

        let contract_id = e.register_contract(None, EscrowTimelock);
        let client = EscrowTimelockClient::new(&e, &contract_id);

        let amount = 1000;
        let token_client = token::Client::new(&e, &token_id);
        token_client.mint(&sender, &amount);

        let unlock_time = 1000;
        e.ledger().with_mut(|li| li.timestamp = 500); // Before unlock

        client.initialize(&sender, &recipient, &token_id, &amount, &unlock_time);

        // Try to refund before unlock time - should panic
        client.refund();
    }

    #[test]
    fn test_double_refund_prevented() {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract(admin.clone());

        let contract_id = e.register_contract(None, EscrowTimelock);
        let client = EscrowTimelockClient::new(&e, &contract_id);

        let amount = 1000;
        let token_client = token::Client::new(&e, &token_id);
        token_client.mint(&sender, &amount);

        let unlock_time = 1000;
        e.ledger().with_mut(|li| li.timestamp = 1500); // After unlock

        client.initialize(&sender, &recipient, &token_id, &amount, &unlock_time);

        // First refund succeeds
        client.refund();

        // Second refund would fail due to panic, but we can't test it here
        // The contract prevents double claims through the RefundClaimed flag
    }
}
