#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, BytesN, Env,
};

/// Supported bridge operations.
#[contracttype]
#[derive(Clone)]
pub enum BridgeOp {
    Mint,
    Burn,
}

/// A cross-chain message submitted by a relayer.
#[contracttype]
#[derive(Clone)]
pub struct BridgeMessage {
    /// Originating chain identifier (e.g. EVM chain-id as u32).
    pub source_chain: u32,
    /// Recipient address on this chain.
    pub recipient: Address,
    /// Token contract address on this chain.
    pub token: Address,
    /// Amount to mint or burn.
    pub amount: i128,
    /// Operation: Mint (inbound) or Burn (outbound).
    pub op: BridgeOp,
    /// Keccak-256 / SHA-256 hash of the originating tx on the source chain.
    pub message_hash: BytesN<32>,
    /// ECDSA / ed25519 signature over `message_hash` by the trusted relayer.
    pub signature: Bytes,
}

/// Storage keys.
#[contracttype]
pub enum DataKey {
    /// Trusted relayer public key (BytesN<32>).
    RelayerKey,
    /// Nonce tracking processed message hashes to prevent replay.
    Processed(BytesN<32>),
    /// Admin address for collateralization management.
    Admin,
    /// Minimum collateralization ratio (basis points: 10000 = 100%).
    MinCollateralRatio,
    /// Locked amount on source chain (source_chain, token_address) -> amount.
    SourceLocked(u32, Address),
    /// Minted amount on destination chain (source_chain, token_address) -> amount.
    DestinationMinted(u32, Address),
    /// Last collateralization update timestamp (source_chain, token_address) -> u64.
    CollateralUpdateTime(u32, Address),
}

#[contract]
pub struct Bridge;

#[contractimpl]
impl Bridge {
    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    /// Initialise the bridge with a trusted relayer public key.
    /// Must be called once by the deployer.
    pub fn initialize(env: Env, admin: Address, relayer_key: BytesN<32>, min_collateral_ratio: u32) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::RelayerKey) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::RelayerKey, &relayer_key);
        env.storage()
            .instance()
            .set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::MinCollateralRatio, &min_collateral_ratio);
    }

    // -----------------------------------------------------------------------
    // Core bridge logic
    // -----------------------------------------------------------------------

    /// Process a verified cross-chain message.
    ///
    /// The relayer submits a `BridgeMessage` together with a signature over
    /// `message_hash`.  The contract:
    ///   1. Verifies the signature against the stored relayer key.
    ///   2. Guards against replay by checking the message hash has not been
    ///      processed before.
    ///   3. For burn operations, verifies adequate collateralization on source chain.
    ///   4. Executes mint (inbound) or burn (outbound) on the wrapped token.
    ///   5. Emits an event for off-chain indexers / relayers.
    pub fn process_message(env: Env, relayer: Address, msg: BridgeMessage) {
        relayer.require_auth();

        // 1. Verify signature
        let relayer_key: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::RelayerKey)
            .expect("not initialized");

        env.crypto()
            .ed25519_verify(&relayer_key, &msg.message_hash.clone().into(), &msg.signature);

        // 2. Replay protection
        let processed_key = DataKey::Processed(msg.message_hash.clone());
        if env.storage().persistent().has(&processed_key) {
            panic!("message already processed");
        }
        env.storage().persistent().set(&processed_key, &true);

        // 3. Mint / Burn with collateralization check
        let token_client = token::Client::new(&env, &msg.token);
        match msg.op {
            BridgeOp::Mint => {
                // Inbound: tokens locked on source chain → mint wrapped tokens here.
                token_client.mint(&msg.recipient, &msg.amount);

                // Update destination minted tracking
                let current_minted: i128 = env
                    .storage()
                    .instance()
                    .get(&DataKey::DestinationMinted(msg.source_chain, msg.token.clone()))
                    .unwrap_or(0);
                env.storage()
                    .instance()
                    .set(&DataKey::DestinationMinted(msg.source_chain, msg.token.clone()), &(current_minted + msg.amount));

                env.events().publish(
                    (symbol_short!("bridge"), symbol_short!("mint")),
                    (
                        msg.source_chain,
                        msg.recipient.clone(),
                        msg.token.clone(),
                        msg.amount,
                        msg.message_hash.clone(),
                    ),
                );
            }
            BridgeOp::Burn => {
                // Verify collateralization before processing burn
                Self::verify_collateralization(&env, msg.source_chain, msg.token.clone(), msg.amount);

                // Outbound: burn wrapped tokens here → unlock on source chain.
                token_client.burn(&msg.recipient, &msg.amount);

                // Update destination minted tracking
                let current_minted: i128 = env
                    .storage()
                    .instance()
                    .get(&DataKey::DestinationMinted(msg.source_chain, msg.token.clone()))
                    .unwrap_or(0);
                env.storage()
                    .instance()
                    .set(&DataKey::DestinationMinted(msg.source_chain, msg.token.clone()), &(current_minted - msg.amount));

                env.events().publish(
                    (symbol_short!("bridge"), symbol_short!("burn")),
                    (
                        msg.source_chain,
                        msg.recipient.clone(),
                        msg.token.clone(),
                        msg.amount,
                        msg.message_hash.clone(),
                    ),
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // Collateralization Management
    // -----------------------------------------------------------------------

    /// Update the locked amount on the source chain for a specific token.
    /// Called by relayer to sync collateralization state from source chain.
    pub fn update_source_locked(env: Env, admin: Address, source_chain: u32, token: Address, locked_amount: i128) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");

        let timestamp = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&DataKey::SourceLocked(source_chain, token.clone()), &locked_amount);
        env.storage()
            .instance()
            .set(&DataKey::CollateralUpdateTime(source_chain, token), &timestamp);

        env.events()
            .publish((symbol_short!("collat_update"), source_chain, token), locked_amount);
    }

    /// Set the minimum collateralization ratio (in basis points).
    /// 10000 = 100% (fully collateralized), 5000 = 50%, etc.
    pub fn set_min_collateral_ratio(env: Env, admin: Address, min_ratio: u32) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("admin not set");
        assert!(admin == stored_admin, "unauthorized");
        assert!(min_ratio > 0 && min_ratio <= 10000, "invalid ratio");

        env.storage()
            .instance()
            .set(&DataKey::MinCollateralRatio, &min_ratio);

        env.events()
            .publish((symbol_short!("min_ratio"), admin), min_ratio);
    }

    /// Verify that there is adequate collateralization on the source chain
    /// before processing a burn operation.
    fn verify_collateralization(env: &Env, source_chain: u32, token: Address, burn_amount: i128) {
        let source_locked: i128 = env
            .storage()
            .instance()
            .get(&DataKey::SourceLocked(source_chain, token.clone()))
            .unwrap_or(0);

        let destination_minted: i128 = env
            .storage()
            .instance()
            .get(&DataKey::DestinationMinted(source_chain, token.clone()))
            .unwrap_or(0);

        let min_ratio: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinCollateralRatio)
            .unwrap_or(10000); // Default to 100%

        // Calculate the minted amount after this burn
        let new_minted = destination_minted - burn_amount;

        // If new_minted is 0 or negative, collateralization is satisfied
        if new_minted <= 0 {
            return;
        }

        // Calculate current collateralization ratio
        // ratio = (source_locked / new_minted) * 10000
        let current_ratio = if new_minted > 0 {
            (source_locked * 10000) / new_minted
        } else {
            0
        };

        assert!(
            current_ratio >= min_ratio as i128,
            "insufficient collateralization: current={}%, required={}%",
            current_ratio / 100,
            min_ratio / 100
        );
    }

    // -----------------------------------------------------------------------
    // View helpers
    // -----------------------------------------------------------------------

    /// Returns `true` if the given message hash has already been processed.
    pub fn is_processed(env: Env, message_hash: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Processed(message_hash))
    }

    /// Returns the stored relayer public key.
    pub fn relayer_key(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&DataKey::RelayerKey)
            .expect("not initialized")
    }

    /// Returns the locked amount on the source chain for a specific token.
    pub fn get_source_locked(env: Env, source_chain: u32, token: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::SourceLocked(source_chain, token))
            .unwrap_or(0)
    }

    /// Returns the minted amount on the destination chain for a specific token.
    pub fn get_destination_minted(env: Env, source_chain: u32, token: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::DestinationMinted(source_chain, token))
            .unwrap_or(0)
    }

    /// Returns the current collateralization ratio (in basis points) for a token.
    pub fn get_collateralization_ratio(env: Env, source_chain: u32, token: Address) -> u32 {
        let source_locked = Self::get_source_locked(env.clone(), source_chain, token.clone());
        let destination_minted = Self::get_destination_minted(env.clone(), source_chain, token.clone());

        if destination_minted <= 0 {
            return 10000; // Fully collateralized if nothing minted
        }

        ((source_locked * 10000) / destination_minted) as u32
    }

    /// Returns the minimum required collateralization ratio (in basis points).
    pub fn get_min_collateral_ratio(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MinCollateralRatio)
            .unwrap_or(10000)
    }

    /// Returns whether a burn operation would be allowed based on collateralization.
    pub fn is_burn_allowed(env: Env, source_chain: u32, token: Address, burn_amount: i128) -> bool {
        let source_locked = Self::get_source_locked(env.clone(), source_chain, token.clone());
        let destination_minted = Self::get_destination_minted(env.clone(), source_chain, token.clone());
        let min_ratio = Self::get_min_collateral_ratio(env.clone()) as i128;

        let new_minted = destination_minted - burn_amount;

        if new_minted <= 0 {
            return true;
        }

        let current_ratio = (source_locked * 10000) / new_minted;
        current_ratio >= min_ratio
    }

    /// Returns the last collateralization update timestamp for a token.
    pub fn get_collateral_update_time(env: Env, source_chain: u32, token: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CollateralUpdateTime(source_chain, token))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, token::StellarAssetClient};

    fn setup() -> (Env, BridgeClient<'static>, Address, Address, BytesN<32>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);
        let relayer_key = BytesN::from_array(&env, &[1u8; 32]);

        let contract_id = env.register_contract(None, Bridge);
        let client = BridgeClient::new(&env, &contract_id);

        client.initialize(&admin, &relayer_key, &10000); // 100% collateralization

        (env, client, admin, relayer, relayer_key)
    }

    fn create_bridge_message(
        env: &Env,
        source_chain: u32,
        recipient: Address,
        token: Address,
        amount: i128,
        op: BridgeOp,
    ) -> BridgeMessage {
        let message_hash = BytesN::from_array(&env, &[0u8; 32]);
        let signature = Bytes::from_slice(&env, &[0u8; 64]);

        BridgeMessage {
            source_chain,
            recipient,
            token,
            amount,
            op,
            message_hash,
            signature,
        }
    }

    #[test]
    fn test_initialize_with_collateralization() {
        let (env, client, admin, _, _) = setup();

        assert_eq!(client.get_min_collateral_ratio(), 10000);
    }

    #[test]
    fn test_update_source_locked() {
        let (env, client, admin, _, _) = setup();
        let source_chain = 1u32;
        let token = Address::generate(&env);

        client.update_source_locked(&admin, &source_chain, &token, &1000);

        assert_eq!(client.get_source_locked(source_chain, token), 1000);
    }

    #[test]
    fn test_set_min_collateral_ratio() {
        let (env, client, admin, _, _) = setup();

        client.set_min_collateral_ratio(&admin, &8000); // 80%

        assert_eq!(client.get_min_collateral_ratio(), 8000);
    }

    #[test]
    #[should_panic(expected = "invalid ratio")]
    fn test_set_invalid_collateral_ratio() {
        let (env, client, admin, _, _) = setup();

        client.set_min_collateral_ratio(&admin, &15000); // Invalid: > 100%
    }

    #[test]
    fn test_mint_tracks_destination_minted() {
        let (env, client, admin, relayer, relayer_key) = setup();
        let source_chain = 1u32;
        let token = Address::generate(&env);
        let recipient = Address::generate(&env);

        // Register a token contract for testing
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_client = StellarAssetClient::new(&env, &token_id.address());
        token_client.mint(&admin, &10000);

        let mut msg = create_bridge_message(
            &env,
            source_chain,
            recipient.clone(),
            token_id.address(),
            1000,
            BridgeOp::Mint,
        );

        // Sign the message
        let signature = env.crypto().ed25519_sign(&relayer_key, &msg.message_hash.clone().into());
        msg.signature = signature;

        client.process_message(&relayer, &msg);

        assert_eq!(client.get_destination_minted(source_chain, token_id.address()), 1000);
    }

    #[test]
    fn test_burn_decreases_destination_minted() {
        let (env, client, admin, relayer, relayer_key) = setup();
        let source_chain = 1u32;
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_client = StellarAssetClient::new(&env, &token_id.address());
        let recipient = Address::generate(&env);

        token_client.mint(&admin, &10000);
        token_client.mint(&recipient, &5000);

        // Set up source locked collateral
        client.update_source_locked(&admin, &source_chain, &token_id.address(), &5000);

        // Mint first
        let mut msg = create_bridge_message(
            &env,
            source_chain,
            recipient.clone(),
            token_id.address(),
            1000,
            BridgeOp::Mint,
        );
        let signature = env.crypto().ed25519_sign(&relayer_key, &msg.message_hash.clone().into());
        msg.signature = signature;
        client.process_message(&relayer, &msg);

        assert_eq!(client.get_destination_minted(source_chain, token_id.address()), 1000);

        // Now burn
        let mut burn_msg = create_bridge_message(
            &env,
            source_chain,
            recipient.clone(),
            token_id.address(),
            500,
            BridgeOp::Burn,
        );
        let burn_signature = env.crypto().ed25519_sign(&relayer_key, &burn_msg.message_hash.clone().into());
        burn_msg.signature = burn_signature;
        client.process_message(&relayer, &burn_msg);

        assert_eq!(client.get_destination_minted(source_chain, token_id.address()), 500);
    }

    #[test]
    fn test_collateralization_ratio_calculation() {
        let (env, client, admin, _, _) = setup();
        let source_chain = 1u32;
        let token = Address::generate(&env);

        client.update_source_locked(&admin, &source_chain, &token, &10000);

        // Simulate minting via internal tracking
        env.storage()
            .instance()
            .set(&DataKey::DestinationMinted(source_chain, token.clone()), &8000);

        assert_eq!(client.get_collateralization_ratio(source_chain, token), 12500); // 125%
    }

    #[test]
    fn test_is_burn_allowed_with_sufficient_collateral() {
        let (env, client, admin, _, _) = setup();
        let source_chain = 1u32;
        let token = Address::generate(&env);

        client.update_source_locked(&admin, &source_chain, &token, &10000);
        env.storage()
            .instance()
            .set(&DataKey::DestinationMinted(source_chain, token.clone()), &8000);

        // Burning 1000 would leave 7000 minted, ratio = 10000/7000 = 143% > 100% (allowed)
        assert!(client.is_burn_allowed(source_chain, token, 1000));
    }

    #[test]
    fn test_is_burn_denied_with_insufficient_collateral() {
        let (env, client, admin, _, _) = setup();
        let source_chain = 1u32;
        let token = Address::generate(&env);

        client.update_source_locked(&admin, &source_chain, &token, &5000);
        env.storage()
            .instance()
            .set(&DataKey::DestinationMinted(source_chain, token.clone()), &8000);

        // Burning 1000 would leave 7000 minted, ratio = 5000/7000 = 71% < 100% (denied)
        assert!(!client.is_burn_allowed(source_chain, token, 1000));
    }

    #[test]
    fn test_burn_fails_with_insufficient_collateral() {
        let (env, client, admin, relayer, relayer_key) = setup();
        let source_chain = 1u32;
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_client = StellarAssetClient::new(&env, &token_id.address());
        let recipient = Address::generate(&env);

        token_client.mint(&admin, &10000);
        token_client.mint(&recipient, &5000);

        // Set insufficient collateral
        client.update_source_locked(&admin, &source_chain, &token_id.address(), &5000);

        // Simulate previous mints
        env.storage()
            .instance()
            .set(&DataKey::DestinationMinted(source_chain, token_id.address()), &8000);

        let mut burn_msg = create_bridge_message(
            &env,
            source_chain,
            recipient,
            token_id.address(),
            1000,
            BridgeOp::Burn,
        );
        let burn_signature = env.crypto().ed25519_sign(&relayer_key, &burn_msg.message_hash.clone().into());
        burn_msg.signature = burn_signature;

        // Should fail due to insufficient collateralization
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.process_message(&relayer, &burn_msg);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_burn_succeeds_with_sufficient_collateral() {
        let (env, client, admin, relayer, relayer_key) = setup();
        let source_chain = 1u32;
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_client = StellarAssetClient::new(&env, &token_id.address());
        let recipient = Address::generate(&env);

        token_client.mint(&admin, &10000);
        token_client.mint(&recipient, &5000);

        // Set sufficient collateral
        client.update_source_locked(&admin, &source_chain, &token_id.address(), &10000);

        // Simulate previous mints
        env.storage()
            .instance()
            .set(&DataKey::DestinationMinted(source_chain, token_id.address()), &5000);

        let mut burn_msg = create_bridge_message(
            &env,
            source_chain,
            recipient.clone(),
            token_id.address(),
            1000,
            BridgeOp::Burn,
        );
        let burn_signature = env.crypto().ed25519_sign(&relayer_key, &burn_msg.message_hash.clone().into());
        burn_msg.signature = burn_signature;

        // Should succeed
        client.process_message(&relayer, &burn_msg);

        assert_eq!(client.get_destination_minted(source_chain, token_id.address()), 4000);
    }

    #[test]
    fn test_collateral_update_time_tracked() {
        let (env, client, admin, _, _) = setup();
        let source_chain = 1u32;
        let token = Address::generate(&env);

        assert_eq!(client.get_collateral_update_time(source_chain, token), 0);

        client.update_source_locked(&admin, &source_chain, &token, &1000);

        let update_time = client.get_collateral_update_time(source_chain, token);
        assert!(update_time > 0);
    }

    #[test]
    fn test_adjustable_collateralization_ratio() {
        let (env, client, admin, _, _) = setup();
        let source_chain = 1u32;
        let token = Address::generate(&env);

        client.update_source_locked(&admin, &source_chain, &token, &8000);
        env.storage()
            .instance()
            .set(&DataKey::DestinationMinted(source_chain, token.clone()), &10000);

        // With 100% requirement, burn is denied
        assert!(!client.is_burn_allowed(source_chain, token, 1000));

        // Lower requirement to 70%
        client.set_min_collateral_ratio(&admin, &7000);

        // Now burn should be allowed
        assert!(client.is_burn_allowed(source_chain, token, 1000));
    }

    #[test]
    fn test_burn_allowed_when_minted_becomes_zero() {
        let (env, client, admin, _, _) = setup();
        let source_chain = 1u32;
        let token = Address::generate(&env);

        client.update_source_locked(&admin, &source_chain, &token, &1000);
        env.storage()
            .instance()
            .set(&DataKey::DestinationMinted(source_chain, token.clone()), &1000);

        // Burning all minted tokens should be allowed even with low collateral
        assert!(client.is_burn_allowed(source_chain, token, 1000));
    }

    #[test]
    fn test_multiple_chains_tracked_separately() {
        let (env, client, admin, _, _) = setup();
        let chain1 = 1u32;
        let chain2 = 2u32;
        let token = Address::generate(&env);

        client.update_source_locked(&admin, &chain1, &token, &1000);
        client.update_source_locked(&admin, &chain2, &token, &2000);

        assert_eq!(client.get_source_locked(chain1, token), 1000);
        assert_eq!(client.get_source_locked(chain2, token), 2000);

        env.storage()
            .instance()
            .set(&DataKey::DestinationMinted(chain1, token.clone()), &500);
        env.storage()
            .instance()
            .set(&DataKey::DestinationMinted(chain2, token), &1000);

        assert_eq!(client.get_collateralization_ratio(chain1, token), 20000); // 200%
        assert_eq!(client.get_collateralization_ratio(chain2, token), 20000); // 200%
    }
}
