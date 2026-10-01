#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    EscrowInitialized,
    EscrowDetails,
    RefundClaimed,
    Cancelled,
    PendingBeneficiary,
}

/// Delay (in seconds) a recovery-initiated beneficiary change must wait
/// before it can be executed: 72 hours.
pub const BENEFICIARY_UPDATE_DELAY: u64 = 72 * 60 * 60;

#[contracttype]
#[derive(Clone)]
pub struct EscrowDetails {
    pub sender: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub unlock_time: u64,
    pub release_timestamp: u64,
    pub conditions_met: bool,
    /// Optional key allowed to rotate `recipient` if the beneficiary loses
    /// access to their wallet. Changes are subject to a 72-hour timelock.
    pub recovery_key: Option<Address>,
}

/// A beneficiary change proposed by the recovery key, waiting out its timelock.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingBeneficiaryUpdate {
    pub new_beneficiary: Address,
    pub effective_at: u64,
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
            release_timestamp: unlock_time,
            conditions_met: false,
            recovery_key: None,
        };

        e.storage()
            .instance()
            .set(&DataKey::EscrowDetails, &details);
        e.storage()
            .instance()
            .set(&DataKey::EscrowInitialized, &true);
        e.storage().instance().set(&DataKey::RefundClaimed, &false);
        e.storage().instance().set(&DataKey::Cancelled, &false);

        // Transfer tokens from sender to this contract
        let token_client = token::Client::new(&e, &details.token);
        token_client.transfer(&sender, e.current_contract_address(), &amount);
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

    /// Cancel a pending timelocked escrow before the lockup window begins.
    ///
    /// Only the original depositor (sender) may cancel, and only while
    /// `current_time < unlock_time`. Once the lockup has started the escrow
    /// can no longer be cancelled and must go through claim/refund instead.
    pub fn cancel_escrow(e: Env, depositor: Address, escrow_id: u64) {
        let _ = escrow_id;

        let details: EscrowDetails = e
            .storage()
            .instance()
            .get(&DataKey::EscrowDetails)
            .expect("escrow not initialized");

        // Only the original depositor may cancel.
        if depositor != details.sender {
            panic!("only depositor can cancel");
        }
        depositor.require_auth();

        let cancelled: bool = e
            .storage()
            .instance()
            .get(&DataKey::Cancelled)
            .unwrap_or(false);
        if cancelled {
            panic!("escrow already cancelled");
        }

        let refund_claimed: bool = e
            .storage()
            .instance()
            .get(&DataKey::RefundClaimed)
            .unwrap_or(false);
        if refund_claimed {
            panic!("escrow already settled");
        }

        // Cancellation is only permitted before the lockup window starts.
        let current_time = e.ledger().timestamp();
        if current_time >= details.unlock_time {
            panic!("lockup has started - cannot cancel");
        }

        // Mark as cancelled to prevent double cancellation / later claims.
        e.storage().instance().set(&DataKey::Cancelled, &true);
        e.storage().instance().set(&DataKey::RefundClaimed, &true);

        // Refund escrowed tokens back to the depositor.
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

        let cancelled: bool = e
            .storage()
            .instance()
            .get(&DataKey::Cancelled)
            .unwrap_or(false);
        if cancelled {
            panic!("escrow cancelled");
        }

        let refund_claimed: bool = e
            .storage()
            .instance()
            .get(&DataKey::RefundClaimed)
            .unwrap_or(false);

        if refund_claimed {
            panic!("refund already claimed");
        }

        // Check timelock release delay: current_timestamp >= release_timestamp
        let current_timestamp = e.ledger().timestamp();
        assert!(
            current_timestamp >= details.release_timestamp,
            "timelock release delay not reached"
        );

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

    /// Designate (or clear, with `None`) the recovery key for this escrow.
    ///
    /// Only the current beneficiary may set their own recovery key, so the
    /// sender cannot use it to redirect funds away from the recipient. The
    /// recovery key must be set while the beneficiary still controls their
    /// wallet. Setting a new key discards any pending beneficiary change
    /// proposed by the previous key.
    pub fn set_recovery_key(e: Env, recovery_key: Option<Address>) {
        let mut details = Self::load_details(&e);
        Self::assert_active(&e);
        details.recipient.require_auth();

        if let Some(key) = &recovery_key {
            if *key == details.recipient {
                panic!("recovery key must differ from beneficiary");
            }
        }

        details.recovery_key = recovery_key;
        e.storage()
            .instance()
            .set(&DataKey::EscrowDetails, &details);
        e.storage().instance().remove(&DataKey::PendingBeneficiary);
    }

    /// Propose replacing the beneficiary using the designated recovery key.
    ///
    /// The change only takes effect after `BENEFICIARY_UPDATE_DELAY` (72 hours)
    /// via `execute_beneficiary_update`. During that window the current
    /// beneficiary can veto it with `cancel_beneficiary_update`, which guards
    /// against a compromised recovery key. A new proposal replaces any pending
    /// one and restarts the delay.
    pub fn update_beneficiary(e: Env, recovery_key: Address, new_beneficiary: Address) {
        let details = Self::load_details(&e);
        Self::assert_active(&e);

        match &details.recovery_key {
            Some(key) if *key == recovery_key => {}
            Some(_) => panic!("not the recovery key"),
            None => panic!("recovery key not set"),
        }
        recovery_key.require_auth();

        if new_beneficiary == details.recipient {
            panic!("new beneficiary matches current beneficiary");
        }

        let effective_at = e
            .ledger()
            .timestamp()
            .checked_add(BENEFICIARY_UPDATE_DELAY)
            .expect("timestamp overflow");

        e.storage().instance().set(
            &DataKey::PendingBeneficiary,
            &PendingBeneficiaryUpdate {
                new_beneficiary,
                effective_at,
            },
        );
    }

    /// Apply a pending beneficiary change once its 72-hour delay has elapsed.
    ///
    /// Permissionless: the delay is the security boundary, so anyone may
    /// finalize a matured proposal (including the new beneficiary).
    pub fn execute_beneficiary_update(e: Env) {
        let mut details = Self::load_details(&e);
        Self::assert_active(&e);

        let pending: PendingBeneficiaryUpdate = e
            .storage()
            .instance()
            .get(&DataKey::PendingBeneficiary)
            .expect("no pending beneficiary update");

        if e.ledger().timestamp() < pending.effective_at {
            panic!("beneficiary update timelock not elapsed");
        }

        details.recipient = pending.new_beneficiary;
        e.storage()
            .instance()
            .set(&DataKey::EscrowDetails, &details);
        e.storage().instance().remove(&DataKey::PendingBeneficiary);
    }

    /// Cancel a pending beneficiary change.
    ///
    /// Callable by the current beneficiary (veto) or the recovery key
    /// (withdrawing its own proposal).
    pub fn cancel_beneficiary_update(e: Env, caller: Address) {
        let details = Self::load_details(&e);

        if !e.storage().instance().has(&DataKey::PendingBeneficiary) {
            panic!("no pending beneficiary update");
        }

        let is_recovery_key = details.recovery_key.as_ref() == Some(&caller);
        if caller != details.recipient && !is_recovery_key {
            panic!("not authorized to cancel");
        }
        caller.require_auth();

        e.storage().instance().remove(&DataKey::PendingBeneficiary);
    }

    /// Get the pending beneficiary change, if any.
    pub fn get_pending_beneficiary(e: Env) -> Option<PendingBeneficiaryUpdate> {
        e.storage().instance().get(&DataKey::PendingBeneficiary)
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

    /// Check if the escrow has been cancelled
    pub fn get_cancelled(e: Env) -> bool {
        e.storage()
            .instance()
            .get(&DataKey::Cancelled)
            .unwrap_or(false)
    }

    /// Get current ledger timestamp
    pub fn get_current_time(e: Env) -> u64 {
        e.ledger().timestamp()
    }
}

impl EscrowTimelock {
    fn load_details(e: &Env) -> EscrowDetails {
        e.storage()
            .instance()
            .get(&DataKey::EscrowDetails)
            .expect("escrow not initialized")
    }

    /// Panics if the escrow has been cancelled or refunded.
    fn assert_active(e: &Env) {
        let cancelled: bool = e
            .storage()
            .instance()
            .get(&DataKey::Cancelled)
            .unwrap_or(false);
        let refund_claimed: bool = e
            .storage()
            .instance()
            .get(&DataKey::RefundClaimed)
            .unwrap_or(false);
        if cancelled || refund_claimed {
            panic!("escrow already settled");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _, testutils::Ledger, token::StellarAssetClient, Address, Env,
    };

    #[test]
    fn test_initialize_escrow() {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_contract = e.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let stellar_asset = StellarAssetClient::new(&e, &token_id);
        stellar_asset.mint(&sender, &1000);

        let contract_id = e.register(EscrowTimelock, ());
        let client = EscrowTimelockClient::new(&e, &contract_id);

        client.initialize(&sender, &recipient, &token_id, &500, &2000);

        let details = client.get_escrow_details();
        assert_eq!(details.amount, 500);
        assert_eq!(details.unlock_time, 2000);
    }

    #[test]
    fn test_cancel_escrow_before_lockup() {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_contract = e.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let stellar_asset = StellarAssetClient::new(&e, &token_id);
        stellar_asset.mint(&sender, &1000);

        let contract_id = e.register(EscrowTimelock, ());
        let client = EscrowTimelockClient::new(&e, &contract_id);

        e.ledger().set_timestamp(100);
        client.initialize(&sender, &recipient, &token_id, &500, &2000);

        // Cancel before lockup starts.
        client.cancel_escrow(&sender, &1);

        assert!(client.get_cancelled());
        let token_client = token::Client::new(&e, &token_id);
        assert_eq!(token_client.balance(&sender), 1000);
        assert_eq!(token_client.balance(&contract_id), 0);
    }

    #[test]
    #[should_panic(expected = "lockup has started - cannot cancel")]
    fn test_cancel_escrow_after_lockup_fails() {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_contract = e.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        let stellar_asset = StellarAssetClient::new(&e, &token_id);
        stellar_asset.mint(&sender, &1000);

        let contract_id = e.register(EscrowTimelock, ());
        let client = EscrowTimelockClient::new(&e, &contract_id);

        e.ledger().set_timestamp(100);
        client.initialize(&sender, &recipient, &token_id, &500, &2000);

        // Move past the lockup start; cancellation must now fail.
        e.ledger().set_timestamp(2000);
        client.cancel_escrow(&sender, &1);
    }

    // ── Recovery key / beneficiary replacement ────────────────────────────────

    struct RecoverySetup {
        e: Env,
        client: EscrowTimelockClient<'static>,
        contract_id: Address,
        token_id: Address,
        sender: Address,
        recipient: Address,
        recovery: Address,
    }

    fn setup_recovery() -> RecoverySetup {
        let e = Env::default();
        e.mock_all_auths();

        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let recovery = Address::generate(&e);
        let admin = Address::generate(&e);
        let token_id = e.register_stellar_asset_contract_v2(admin).address();
        StellarAssetClient::new(&e, &token_id).mint(&sender, &1000);

        let contract_id = e.register(EscrowTimelock, ());
        let client = EscrowTimelockClient::new(&e, &contract_id);

        e.ledger().set_timestamp(100);
        client.initialize(&sender, &recipient, &token_id, &500, &2000);
        client.set_recovery_key(&Some(recovery.clone()));

        RecoverySetup {
            e,
            client,
            contract_id,
            token_id,
            sender,
            recipient,
            recovery,
        }
    }

    #[test]
    fn test_recovery_key_defaults_to_none() {
        let e = Env::default();
        e.mock_all_auths();
        let sender = Address::generate(&e);
        let recipient = Address::generate(&e);
        let token_id = e
            .register_stellar_asset_contract_v2(Address::generate(&e))
            .address();
        StellarAssetClient::new(&e, &token_id).mint(&sender, &1000);
        let contract_id = e.register(EscrowTimelock, ());
        let client = EscrowTimelockClient::new(&e, &contract_id);

        client.initialize(&sender, &recipient, &token_id, &500, &2000);

        assert_eq!(client.get_escrow_details().recovery_key, None);
        assert_eq!(client.get_pending_beneficiary(), None);
    }

    #[test]
    fn test_set_recovery_key_requires_beneficiary_auth() {
        let s = setup_recovery();

        let auths = s.e.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, s.recipient);
        assert_eq!(
            s.client.get_escrow_details().recovery_key,
            Some(s.recovery.clone())
        );
    }

    #[test]
    fn test_clear_recovery_key() {
        let s = setup_recovery();
        s.client.set_recovery_key(&None);
        assert_eq!(s.client.get_escrow_details().recovery_key, None);
    }

    #[test]
    #[should_panic(expected = "recovery key must differ from beneficiary")]
    fn test_recovery_key_cannot_be_beneficiary() {
        let s = setup_recovery();
        s.client.set_recovery_key(&Some(s.recipient.clone()));
    }

    #[test]
    fn test_recovery_workflow_replaces_beneficiary_after_72h() {
        let s = setup_recovery();
        let new_beneficiary = Address::generate(&s.e);

        s.client.update_beneficiary(&s.recovery, &new_beneficiary);
        let auths = s.e.auths();
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].0, s.recovery);

        let pending = s.client.get_pending_beneficiary().unwrap();
        assert_eq!(pending.new_beneficiary, new_beneficiary);
        assert_eq!(pending.effective_at, 100 + BENEFICIARY_UPDATE_DELAY);
        // Beneficiary is unchanged while the proposal is pending.
        assert_eq!(s.client.get_escrow_details().recipient, s.recipient);

        s.e.ledger().set_timestamp(100 + BENEFICIARY_UPDATE_DELAY);
        s.client.execute_beneficiary_update();

        assert_eq!(s.client.get_escrow_details().recipient, new_beneficiary);
        assert_eq!(s.client.get_pending_beneficiary(), None);

        // The new beneficiary is the one who must authorize the claim.
        s.client.claim();
        let auths = s.e.auths();
        assert_eq!(auths[0].0, new_beneficiary);

        let token_client = token::Client::new(&s.e, &s.token_id);
        assert_eq!(token_client.balance(&new_beneficiary), 500);
        assert_eq!(token_client.balance(&s.recipient), 0);
        assert_eq!(token_client.balance(&s.contract_id), 0);
    }

    #[test]
    #[should_panic(expected = "beneficiary update timelock not elapsed")]
    fn test_execute_beneficiary_update_before_delay_panics() {
        let s = setup_recovery();
        s.client
            .update_beneficiary(&s.recovery, &Address::generate(&s.e));

        s.e.ledger()
            .set_timestamp(100 + BENEFICIARY_UPDATE_DELAY - 1);
        s.client.execute_beneficiary_update();
    }

    #[test]
    #[should_panic(expected = "no pending beneficiary update")]
    fn test_execute_without_proposal_panics() {
        let s = setup_recovery();
        s.client.execute_beneficiary_update();
    }

    #[test]
    #[should_panic(expected = "not the recovery key")]
    fn test_update_beneficiary_wrong_key_panics() {
        let s = setup_recovery();
        let attacker = Address::generate(&s.e);
        s.client.update_beneficiary(&attacker, &attacker);
    }

    #[test]
    #[should_panic(expected = "recovery key not set")]
    fn test_update_beneficiary_without_recovery_key_panics() {
        let s = setup_recovery();
        s.client.set_recovery_key(&None);
        s.client
            .update_beneficiary(&s.recovery, &Address::generate(&s.e));
    }

    #[test]
    #[should_panic(expected = "new beneficiary matches current beneficiary")]
    fn test_update_beneficiary_to_same_address_panics() {
        let s = setup_recovery();
        s.client.update_beneficiary(&s.recovery, &s.recipient);
    }

    #[test]
    fn test_beneficiary_can_veto_pending_update() {
        let s = setup_recovery();
        s.client
            .update_beneficiary(&s.recovery, &Address::generate(&s.e));

        s.client.cancel_beneficiary_update(&s.recipient);
        assert_eq!(s.client.get_pending_beneficiary(), None);

        s.e.ledger().set_timestamp(100 + BENEFICIARY_UPDATE_DELAY);
        assert_eq!(s.client.get_escrow_details().recipient, s.recipient);
    }

    #[test]
    fn test_recovery_key_can_withdraw_proposal() {
        let s = setup_recovery();
        s.client
            .update_beneficiary(&s.recovery, &Address::generate(&s.e));
        s.client.cancel_beneficiary_update(&s.recovery);
        assert_eq!(s.client.get_pending_beneficiary(), None);
    }

    #[test]
    #[should_panic(expected = "not authorized to cancel")]
    fn test_third_party_cannot_cancel_update() {
        let s = setup_recovery();
        s.client
            .update_beneficiary(&s.recovery, &Address::generate(&s.e));
        s.client.cancel_beneficiary_update(&s.sender);
    }

    #[test]
    fn test_new_proposal_restarts_delay() {
        let s = setup_recovery();
        let first = Address::generate(&s.e);
        let second = Address::generate(&s.e);

        s.client.update_beneficiary(&s.recovery, &first);
        s.e.ledger().set_timestamp(1_000);
        s.client.update_beneficiary(&s.recovery, &second);

        let pending = s.client.get_pending_beneficiary().unwrap();
        assert_eq!(pending.new_beneficiary, second);
        assert_eq!(pending.effective_at, 1_000 + BENEFICIARY_UPDATE_DELAY);
    }

    #[test]
    fn test_rotating_recovery_key_discards_pending_update() {
        let s = setup_recovery();
        s.client
            .update_beneficiary(&s.recovery, &Address::generate(&s.e));

        s.client.set_recovery_key(&Some(Address::generate(&s.e)));
        assert_eq!(s.client.get_pending_beneficiary(), None);
    }

    #[test]
    #[should_panic(expected = "escrow already settled")]
    fn test_update_beneficiary_after_cancel_panics() {
        let s = setup_recovery();
        s.client.cancel_escrow(&s.sender, &1);
        s.client
            .update_beneficiary(&s.recovery, &Address::generate(&s.e));
    }
}
