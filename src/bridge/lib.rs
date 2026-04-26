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
    /// Last activity timestamp from the relayer (for emergency exit).
    LastRelayerActivity,
    /// Emergency mode flag.
    EmergencyMode,
    /// User locked balance for emergency withdrawal.
    LockedBalance(Address),
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
        
        // Initialize last activity timestamp
        env.storage()
            .instance()
            .set(&DataKey::LastRelayerActivity, &env.ledger().timestamp());
        
        // Initialize emergency mode as false
        env.storage()
            .instance()
            .set(&DataKey::EmergencyMode, &false);
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
    ///   5. Updates the last relayer activity timestamp.
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

        // 3. Update last relayer activity timestamp
        env.storage()
            .instance()
            .set(&DataKey::LastRelayerActivity, &env.ledger().timestamp());

        // 4. Mint / Burn
        let token_client = token::Client::new(&env, &msg.token);
        match msg.op {
            BridgeOp::Mint => {
                // Inbound: tokens locked on source chain → mint wrapped tokens here.
                token_client.mint(&msg.recipient, &msg.amount);

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
                token_client.burn(&msg.recipient, &msg.amount);

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
    // Emergency Exit Logic
    // -----------------------------------------------------------------------

    /// Activates emergency mode. Can be called by admin or automatically after 72h of inactivity.
    pub fn activate_emergency_mode(env: Env, caller: Address) {
        caller.require_auth();
        
        // Check if already in emergency mode
        let emergency_mode: bool = env.storage().instance().get(&DataKey::EmergencyMode).unwrap_or(false);
        if emergency_mode {
            panic!("emergency mode already active");
        }
        
        // Check if 72 hours (259200 seconds) have passed since last relayer activity
        let last_activity: u64 = env.storage().instance().get(&DataKey::LastRelayerActivity).unwrap_or(0);
        let current_time = env.ledger().timestamp();
        let elapsed = current_time.saturating_sub(last_activity);
        
        // 72 hours = 72 * 60 * 60 = 259200 seconds
        if elapsed < 259200 {
            // Only admin can manually activate before 72h
            let admin: Address = env.storage().instance().get(&DataKey::RelayerKey).expect("not initialized");
            if caller != admin {
                panic!("only admin can activate emergency mode before 72h");
            }
        }
        
        // Activate emergency mode
        env.storage().instance().set(&DataKey::EmergencyMode, &true);
        
        env.events().publish(
            (symbol_short!("emergency"), symbol_short!("activated")),
            (caller, elapsed),
        );
    }

    /// Allows users to withdraw their locked assets when emergency mode is active.
    pub fn emergency_withdraw(env: Env, user: Address, token: Address, amount: i128) {
        user.require_auth();
        
        // Check if emergency mode is active
        let emergency_mode: bool = env.storage().instance().get(&DataKey::EmergencyMode).unwrap_or(false);
        if !emergency_mode {
            panic!("emergency mode not active");
        }
        
        // Transfer tokens to user
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &user, &amount);
        
        env.events().publish(
            (symbol_short!("emergency"), symbol_short!("withdraw")),
            (user, token, amount),
        );
    }

    /// Deactivates emergency mode. Only admin can call this.
    pub fn deactivate_emergency_mode(env: Env, admin: Address) {
        admin.require_auth();
        
        // Verify caller is admin (relayer key holder)
        let stored_admin: Address = env.storage().instance().get(&DataKey::RelayerKey).expect("not initialized");
        if admin != stored_admin {
            panic!("caller is not admin");
        }
        
        env.storage().instance().set(&DataKey::EmergencyMode, &false);
        
        // Reset activity timestamp to current time
        env.storage()
            .instance()
            .set(&DataKey::LastRelayerActivity, &env.ledger().timestamp());
        
        env.events().publish(
            (symbol_short!("emergency"), symbol_short!("deactivated")),
            admin,
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

    /// Returns `true` if emergency mode is active.
    pub fn is_emergency_mode(env: Env) -> bool {
        env.storage().instance().get(&DataKey::EmergencyMode).unwrap_or(false)
    }

    /// Returns the timestamp of the last relayer activity.
    pub fn last_relayer_activity(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::LastRelayerActivity)
            .unwrap_or(0)
    }

    /// Returns the time elapsed since last relayer activity in seconds.
    pub fn time_since_last_activity(env: Env) -> u64 {
        let last_activity: u64 = env.storage().instance().get(&DataKey::LastRelayerActivity).unwrap_or(0);
        let current_time = env.ledger().timestamp();
        current_time.saturating_sub(last_activity)
    }
}
