#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, xdr::ToXdr, Address, Bytes, BytesN,
    Env, IntoVal, Vec,
};

#[contracttype]
pub enum DataKey {
    Admin,
    BridgeToken,
    Relayer,
    /// Ed25519 public key of the trusted relayer (BytesN<32>).
    RelayerKey,
    /// Processed message hashes for replay protection (BytesN<32> -> bool).
    Processed(BytesN<32>),
    /// Per-recipient sequential nonce (Address -> u64), last successfully consumed nonce.
    Nonce(Address),
}

/// Client for cross-contract invocation of the Bridge Stub contract.
///
/// Other contracts can instantiate this client and call `burn` or `mint`
/// without needing to use `invoke_contract` directly.
pub struct BridgeContractClient<'a> {
    env: &'a Env,
    contract_id: &'a Address,
}

impl BridgeContractClient<'_> {
    pub fn new(env: &Env, contract_id: &Address) -> Self {
        Self { env, contract_id }
    }

    pub fn burn(
        &self,
        user: &Address,
        amount: &i128,
        dest_chain: &u32,
        dest_recipient: &BytesN<32>,
    ) {
        self.env.invoke_contract::<()>(
            self.contract_id,
            &symbol_short!("burn"),
            (user.clone(), *amount, *dest_chain, dest_recipient.clone()).into_val(self.env),
        );
    }

    pub fn mint(
        &self,
        relayer: &Address,
        recipient: &Address,
        amount: &i128,
        source_chain: &u32,
        nonce: &u64,
        message_hash: &BytesN<32>,
        signature: &BytesN<64>,
    ) {
        self.env.invoke_contract::<()>(
            self.contract_id,
            &symbol_short!("mint"),
            (
                relayer.clone(),
                recipient.clone(),
                *amount,
                *source_chain,
                *nonce,
                message_hash.clone(),
                signature.clone(),
            )
                .into_val(self.env),
        );
    }
}

#[contract]
pub struct BridgeStub;

#[contractimpl]
impl BridgeStub {
    /// Initialize the bridge with an admin, the token to bridge, the authorized relayer address,
    /// and the relayer's Ed25519 public key used for signature verification.
    pub fn initialize(
        env: Env,
        admin: Address,
        bridge_token: Address,
        relayer: Address,
        relayer_key: BytesN<32>,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::BridgeToken, &bridge_token);
        env.storage().instance().set(&DataKey::Relayer, &relayer);
        env.storage()
            .instance()
            .set(&DataKey::RelayerKey, &relayer_key);
        env.events().publish(
            (symbol_short!("br_init"),),
            (admin, bridge_token, relayer, relayer_key),
        );
    }

    /// Burns tokens on this chain to be moved to another chain.
    /// Emits a 'burn' event for off-chain relayers.
    pub fn burn(
        env: Env,
        user: Address,
        amount: i128,
        dest_chain: u32,
        dest_recipient: BytesN<32>,
    ) {
        user.require_auth();
        assert!(amount > 0, "amount must be positive");

        let bridge_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::BridgeToken)
            .unwrap();

        token::Client::new(&env, &bridge_token).transfer(
            &user,
            &env.current_contract_address(),
            &amount,
        );

        // Emit event following strict indexed schema
        env.events()
            .publish((symbol_short!("br_burn"), user, amount, dest_chain), dest_recipient);
    }

    /// Mints tokens on this chain based on a verified message from another chain.
    ///
    /// Security guarantees:
    ///   1. **Ed25519 signature verification** — the relayer must provide a valid
    ///      signature over `message_hash` using the registered relayer key.
    ///   2. **Domain separation** — `message_hash` must equal the SHA-256 digest of the
    ///      canonical payload `(recipient, amount, source_chain, nonce, chain_id, contract_address)`,
    ///      binding the signature to this chain and this contract instance.
    ///   3. **Sequential nonces** — `nonce` must equal `current_nonce + 1` for `recipient`;
    ///      the stored nonce is incremented atomically on success.
    ///   4. **Replay protection** — `message_hash` is recorded in persistent storage so the
    ///      same signed message can never be executed twice.
    pub fn mint(
        env: Env,
        relayer: Address,
        recipient: Address,
        amount: i128,
        source_chain: u32,
        nonce: u64,
        message_hash: BytesN<32>,
        signature: BytesN<64>,
    ) {
        relayer.require_auth();

        // Verify the relayer address matches the registered one.
        let authorized_relayer: Address = env
            .storage()
            .instance()
            .get(&DataKey::Relayer)
            .unwrap();
        if relayer != authorized_relayer {
            panic!("not authorized relayer");
        }

        // ----------------------------------------------------------------
        // 0. Domain-separated payload binding
        // ----------------------------------------------------------------
        // Recompute the expected digest from the claim fields plus the chain id and
        // this contract's address, so a signature cannot be replayed on another
        // network or against another bridge deployment.
        let expected_hash = Self::compute_message_hash(
            &env,
            &recipient,
            amount,
            source_chain,
            nonce,
        );
        if expected_hash != message_hash {
            panic!("invalid message hash");
        }

        // ----------------------------------------------------------------
        // 1. Sequential nonce check
        // ----------------------------------------------------------------
        let nonce_key = DataKey::Nonce(recipient.clone());
        let current_nonce: u64 = env
            .storage()
            .persistent()
            .get(&nonce_key)
            .unwrap_or(0);
        if nonce != current_nonce + 1 {
            panic!("Error::InvalidNonce");
        }

        // ----------------------------------------------------------------
        // 2. Ed25519 signature verification
        // ----------------------------------------------------------------
        let relayer_key: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::RelayerKey)
            .expect("relayer key not set");

        env.crypto().ed25519_verify(
            &relayer_key,
            &message_hash.clone().into(),
            &signature,
        );

        // ----------------------------------------------------------------
        // 3. Replay protection
        // ----------------------------------------------------------------
        let processed_key = DataKey::Processed(message_hash.clone());
        if env.storage().persistent().has(&processed_key) {
            panic!("Error::SignatureAlreadyUsed");
        }
        env.storage().persistent().set(&processed_key, &true);

        // Atomically advance the nonce together with the claim.
        env.storage().persistent().set(&nonce_key, &nonce);

        // Mint/Transfer tokens
        let bridge_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::BridgeToken)
            .unwrap();
        token::Client::new(&env, &bridge_token).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );

        // Emit event
        env.events()
            .publish((symbol_short!("br_mint"), recipient, amount, source_chain), nonce);
    }

    /// Update relayer address and key (admin only).
    pub fn set_relayer(env: Env, admin: Address, new_relayer: Address, new_relayer_key: BytesN<32>) {
        admin.require_auth();
        let current_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap();
        assert_eq!(admin, current_admin, "not authorized");

        env.storage()
            .instance()
            .set(&DataKey::Relayer, &new_relayer);
        env.storage()
            .instance()
            .set(&DataKey::RelayerKey, &new_relayer_key);
    }

    /// Returns whether the given message hash has already been processed.
    pub fn is_processed(env: Env, message_hash: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Processed(message_hash))
    }

    /// Returns the last consumed nonce for `recipient` (0 if none).
    pub fn current_nonce(env: Env, recipient: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::Nonce(recipient))
            .unwrap_or(0)
    }

    /// Canonical domain-separated digest for a cross-chain claim.
    /// Binds recipient, amount, source chain, nonce, the local chain id and this contract address.
    pub fn compute_message_hash(
        env: &Env,
        recipient: &Address,
        amount: i128,
        source_chain: u32,
        nonce: u64,
    ) -> BytesN<32> {
        let mut payload = Bytes::new(env);
        payload.append(&Bytes::from_slice(env, b"stellar-bridge-claim-v1"));
        payload.append(&recipient.clone().to_xdr(env));
        payload.append(&Bytes::from_slice(env, &amount.to_be_bytes()));
        payload.append(&Bytes::from_slice(env, &source_chain.to_be_bytes()));
        payload.append(&Bytes::from_slice(env, &nonce.to_be_bytes()));
        payload.append(&Bytes::from_slice(env, &env.ledger().network_id().to_array()));
        payload.append(&env.current_contract_address().to_xdr(env));
        env.crypto().sha256(&payload).into()
    }
}

#[cfg(test)]
mod tests {
    extern crate ed25519_dalek;
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token,
        Address, BytesN, Env,
    };

    /// Generate a fresh Ed25519 key pair and return (secret_bytes, public_key_BytesN<32>).
    fn gen_keypair(env: &Env) -> ([u8; 32], BytesN<32>) {
        let secret = [1u8; 32];
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&secret);
        let pub_key = signing_key.verifying_key();
        (secret, BytesN::from_array(env, pub_key.as_bytes()))
    }

    /// Sign `message` with `secret` and return a 64-byte `BytesN<64>`.
    fn sign(env: &Env, secret: &[u8; 32], message: &[u8]) -> BytesN<64> {
        use ed25519_dalek::Signer;
        let signing_key = ed25519_dalek::SigningKey::from_bytes(secret);
        let sig = signing_key.sign(message);
        BytesN::from_array(env, &sig.to_bytes())
    }

    fn setup_with_secret() -> (Env, BridgeStubClient<'static>, Address, Address, Address, [u8; 32]) {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let relayer = Address::generate(&env);

        let (secret, relayer_key) = gen_keypair(&env);

        // Deploy token
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_sac = token::StellarAssetClient::new(&env, &token_id.address());
        let user = Address::generate(&env);
        token_sac.mint(&user, &1000);

        let bridge_id = env.register_contract(None, BridgeStub);
        let bridge_client = BridgeStubClient::new(&env, &bridge_id);
        bridge_client.initialize(&admin, &token_id.address(), &relayer, &relayer_key);

        // Give bridge contract some tokens for minting
        token_sac.mint(&bridge_id, &100_000);

        (env, bridge_client, admin, relayer, token_id.address(), secret)
    }

    /// Helper: compute the domain-bound hash for a claim and sign it.
    fn signed_claim(
        env: &Env,
        bridge: &BridgeStubClient,
        secret: &[u8; 32],
        recipient: &Address,
        amount: i128,
        source_chain: u32,
        nonce: u64,
    ) -> (BytesN<32>, BytesN<64>) {
        let hash = env.as_contract(&bridge.address, || {
            BridgeStub::compute_message_hash(env, recipient, amount, source_chain, nonce)
        });
        let sig = sign(env, secret, &hash.to_array());
        (hash, sig)
    }

    // -----------------------------------------------------------------------
    // Existing behaviour tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_burn_event() {
        let (env, bridge_client, _admin, _relayer, _token_addr, _secret) = setup_with_secret();
        let user = Address::generate(&env);
        // Give user tokens
        let token_admin = Address::generate(&env);
        let token_id2 = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_sac2 = token::StellarAssetClient::new(&env, &token_id2.address());
        token_sac2.mint(&user, &500);

        // Re-initialize a fresh bridge for this token
        let (secret2, relayer_key2) = gen_keypair(&env);
        let bridge2 = env.register_contract(None, BridgeStub);
        let relayer2 = Address::generate(&env);
        let client2 = BridgeStubClient::new(&env, &bridge2);
        client2.initialize(&_admin, &token_id2.address(), &relayer2, &relayer_key2);

        let dest_recipient = BytesN::from_array(&env, &[7u8; 32]);
        client2.burn(&user, &100, &2, &dest_recipient);
    }

    #[test]
    fn test_mint_with_valid_signature() {
        let (env, bridge_client, _admin, relayer, _token_addr, secret) = setup_with_secret();
        let recipient = Address::generate(&env);

        let (message_hash, signature) =
            signed_claim(&env, &bridge_client, &secret, &recipient, 100, 1, 1);

        bridge_client.mint(&relayer, &recipient, &100, &1, &1, &message_hash, &signature);

        // Replay protection: hash is now marked as processed.
        assert!(bridge_client.is_processed(&message_hash));
        // Nonce advanced atomically.
        assert_eq!(bridge_client.current_nonce(&recipient), 1);
    }

    // -----------------------------------------------------------------------
    // Ed25519 signature verification tests
    // -----------------------------------------------------------------------

    #[test]
    #[should_panic]
    fn test_mint_with_invalid_signature_is_rejected() {
        let (env, bridge_client, _admin, relayer, _token_addr, _secret) = setup_with_secret();
        let recipient = Address::generate(&env);

        let (message_hash, _) = {
            let secret = [1u8; 32];
            signed_claim(&env, &bridge_client, &secret, &recipient, 100, 1, 1)
        };
        // Use all-zero bytes as a completely invalid signature.
        let bad_signature = BytesN::from_array(&env, &[0u8; 64]);

        // Should panic because signature verification fails.
        bridge_client.mint(&relayer, &recipient, &100, &1, &1, &message_hash, &bad_signature);
    }

    // -----------------------------------------------------------------------
    // Replay / nonce tests
    // -----------------------------------------------------------------------

    #[test]
    #[should_panic]
    fn test_replayed_signature_is_rejected() {
        let (env, bridge_client, _admin, relayer, _token_addr, secret) = setup_with_secret();
        let recipient = Address::generate(&env);

        let (message_hash, signature) =
            signed_claim(&env, &bridge_client, &secret, &recipient, 100, 1, 1);

        bridge_client.mint(&relayer, &recipient, &100, &1, &1, &message_hash, &signature);
        // Replaying the identical claim must fail (nonce is now stale).
        bridge_client.mint(&relayer, &recipient, &100, &1, &1, &message_hash, &signature);
    }

    #[test]
    #[should_panic]
    fn test_nonce_must_be_sequential() {
        let (env, bridge_client, _admin, relayer, _token_addr, secret) = setup_with_secret();
        let recipient = Address::generate(&env);

        // Skipping nonce 1 and submitting nonce 2 must be rejected.
        let (message_hash, signature) =
            signed_claim(&env, &bridge_client, &secret, &recipient, 100, 1, 2);
        bridge_client.mint(&relayer, &recipient, &100, &1, &2, &message_hash, &signature);
    }

    #[test]
    #[should_panic]
    fn test_signature_bound_to_chain_and_contract() {
        let (env, bridge_client, _admin, relayer, _token_addr, secret) = setup_with_secret();
        let recipient = Address::generate(&env);

        // Sign a digest that was computed for a different contract address.
        let other_contract = env.register_contract(None, BridgeStub);
        let foreign_hash = env.as_contract(&other_contract, || {
            BridgeStub::compute_message_hash(&env, &recipient, 100, 1, 1)
        });
        let signature = sign(&env, &secret, &foreign_hash.to_array());

        // Presenting it to this bridge must fail the domain-binding check.
        bridge_client.mint(&relayer, &recipient, &100, &1, &1, &foreign_hash, &signature);
    }
}
