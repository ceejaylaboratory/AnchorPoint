#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env, IntoVal,
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
    pub signature: BytesN<64>,
}

/// Storage keys.
#[contracttype]
pub enum DataKey {
    /// Trusted relayer public key (BytesN<32>).
    RelayerKey,
    /// Nonce tracking processed message hashes to prevent replay.
    Processed(BytesN<32>),
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
    pub fn initialize(env: Env, admin: Address, relayer_key: BytesN<32>) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::RelayerKey) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::RelayerKey, &relayer_key);
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
    ///   3. Executes mint (inbound) or burn (outbound) on the wrapped token.
    ///   4. Emits an event for off-chain indexers / relayers.
    pub fn process_message(env: Env, relayer: Address, msg: BridgeMessage) {
        relayer.require_auth();

        // 1. Verify signature
        let relayer_key: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::RelayerKey)
            .expect("not initialized");

        env.crypto().ed25519_verify(
            &relayer_key,
            &msg.message_hash.clone().into(),
            &msg.signature,
        );

        // 2. Replay protection
        let processed_key = DataKey::Processed(msg.message_hash.clone());
        if env.storage().persistent().has(&processed_key) {
            panic!("message already processed");
        }
        env.storage().persistent().set(&processed_key, &true);

        // 3. Mint / Burn
        let _token_client = token::Client::new(&env, &msg.token);
        match msg.op {
            BridgeOp::Mint => {
                // Inbound: tokens locked on source chain → mint wrapped tokens here.
                env.invoke_contract::<()>(
                    &msg.token,
                    &symbol_short!("mint"),
                    soroban_sdk::vec![&env, msg.recipient.to_val(), msg.amount.into_val(&env)],
                );

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
                // Outbound: burn wrapped tokens here → unlock on source chain.
                env.invoke_contract::<()>(
                    &msg.token,
                    &symbol_short!("burn"),
                    soroban_sdk::vec![&env, msg.recipient.to_val(), msg.amount.into_val(&env)],
                );

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
}
