#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec, token};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Signers,
    Threshold,
    Recipient,
    Initialized,
}

#[contract]
pub struct EscrowMultisig;

#[contractimpl]
impl EscrowMultisig {

    pub fn set_security_registry(env: soroban_sdk::Env, registry: soroban_sdk::Address) {
        if env.storage().instance().has(&soroban_sdk::symbol_short!("sec_reg")) {
            panic!("already set");
        }
        env.storage().instance().set(&soroban_sdk::symbol_short!("sec_reg"), &registry);
    }

    /// Initialize the escrow contract with signers, threshold, and recipient.
    pub fn initialize(e: Env, signers: Vec<Address>, threshold: u32, recipient: Address) {
        if e.storage().instance().has(&DataKey::Initialized) {
            panic!("already initialized");
        }
        if threshold == 0 || threshold > signers.len() {
            panic!("invalid threshold");
        }
        
        e.storage().instance().set(&DataKey::Signers, &signers);
        e.storage().instance().set(&DataKey::Threshold, &threshold);
        e.storage().instance().set(&DataKey::Recipient, &recipient);
        e.storage().instance().set(&DataKey::Initialized, &true);
    }
    
    /// Release funds to the recipient.
    /// Requires authorization from M-of-N signers.
    /// The `signers` parameter specifies which M signers are authorizing the release.
    pub fn release(e: Env, signers: Vec<Address>, token: Address) {
        let stored_signers: Vec<Address> = e.storage().instance().get(&DataKey::Signers).expect("not initialized");
        let threshold: u32 = e.storage().instance().get(&DataKey::Threshold).expect("not initialized");
        let recipient: Address = e.storage().instance().get(&DataKey::Recipient).expect("not initialized");
        
        if signers.len() < threshold {
            panic!("not enough signers provided");
        }
        
        // Verify all provided signers are valid and have authorized the call
        for signer in signers.iter() {
            let mut is_valid = false;
            for stored_signer in stored_signers.iter() {
                if signer == stored_signer {
                    is_valid = true;
                    break;
                }
            }
            if !is_valid {
                panic!("invalid signer provided");
            }
            
            // This will fail the entire transaction if the signer hasn't authorized this call.
            signer.require_auth();
        }
        
        // Get the current balance of the contract for the specified token.
        let token_client = token::Client::new(&e, &token);
        let balance = token_client.balance(&e.current_contract_address());
        
        if balance > 0 {
            token_client.transfer(&e.current_contract_address(), &recipient, &balance);
        }
    }

    /// Get the list of signers.
    pub fn get_signers(e: Env) -> Vec<Address> {
        e.storage().instance().get(&DataKey::Signers).unwrap_or(Vec::new(&e))
    }

    /// Get the threshold.
    pub fn get_threshold(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Threshold).unwrap_or(0)
    }

    /// Get the recipient.
    pub fn get_recipient(e: Env) -> Address {
        e.storage().instance().get(&DataKey::Recipient).expect("recipient not set")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

    #[test]
    fn test_multisig_escrow_release() {
        let e = Env::default();
        e.mock_all_auths();

        let signers = Vec::from_array(&e, [
            Address::generate(&e),
            Address::generate(&e),
            Address::generate(&e),
            Address::generate(&e),
            Address::generate(&e),
        ]);
        let threshold = 3;
        let recipient = Address::generate(&e);

        let contract_id = e.register_contract(None, EscrowMultisig);
        let client = EscrowMultisigClient::new(&e, &contract_id);

        // Initialize the contract
        client.initialize(&signers, &threshold, &recipient);

        assert_eq!(client.get_signers(), signers);
        assert_eq!(client.get_threshold(), threshold);
        assert_eq!(client.get_recipient(), recipient);

        // Setup a mock token
        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract(admin.clone());
        let token_client = token::Client::new(&e, &token_id);

        // Mint tokens to the contract
        let deposit_amount = 1000;
        token_client.mint(&contract_id, &deposit_amount);
        assert_eq!(token_client.balance(&contract_id), deposit_amount);

        // Prepare signers list (M-of-N)
        let m_signers = Vec::from_array(&e, [
            signers.get(0).unwrap(),
            signers.get(2).unwrap(),
            signers.get(4).unwrap(),
        ]);

        // Release tokens
        client.release(&m_signers, &token_id);

        // Check balance of recipient
        assert_eq!(token_client.balance(&recipient), deposit_amount);
        assert_eq!(token_client.balance(&contract_id), 0);
    }

    #[test]
    #[should_panic(expected = "not enough signers provided")]
    fn test_not_enough_signers() {
        let e = Env::default();
        e.mock_all_auths();

        let signers = Vec::from_array(&e, [
            Address::generate(&e),
            Address::generate(&e),
            Address::generate(&e),
        ]);
        let threshold = 2;
        let recipient = Address::generate(&e);

        let contract_id = e.register_contract(None, EscrowMultisig);
        let client = EscrowMultisigClient::new(&e, &contract_id);

        client.initialize(&signers, &threshold, &recipient);

        let m_signers = Vec::from_array(&e, [signers.get(0).unwrap()]); // only 1 signer
        let token_id = Address::generate(&e); // dummy
        client.release(&m_signers, &token_id);
    }

    #[test]
    #[should_panic(expected = "invalid signer provided")]
    fn test_invalid_signer() {
        let e = Env::default();
        e.mock_all_auths();

        let signers = Vec::from_array(&e, [
            Address::generate(&e),
            Address::generate(&e),
        ]);
        let threshold = 1;
        let recipient = Address::generate(&e);

        let contract_id = e.register_contract(None, EscrowMultisig);
        let client = EscrowMultisigClient::new(&e, &contract_id);

        client.initialize(&signers, &threshold, &recipient);

        let m_signers = Vec::from_array(&e, [Address::generate(&e)]); // Random address not in signers
        let token_id = Address::generate(&e); // dummy
        client.release(&m_signers, &token_id);
    }
}
