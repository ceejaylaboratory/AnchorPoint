#![no_std]
//! Secure Random Number Generation Contract (Commit-Reveal Scheme)
//!
//! This contract implements a two-phase commit-reveal random number generator
//! to ensure secure and tamper-resistant randomness on-chain.
//!
//! Phases:
//! 1. Commit Phase: Users commit a hash of their secret value
//! 2. Reveal Phase: Users reveal their secrets, and a random seed is generated via XOR/Hashing
//!
//! Security Features:
//! - Prevents front-running through commitment scheme
//! - Aggregates multiple sources of entropy
//! - Ensures all participants reveal before computing final random value

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
};

/// Phases of the commit-reveal protocol
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum Phase {
    /// Commit phase - users can submit commitments
    COMMIT,
    /// Reveal phase - users can reveal their secrets
    REVEAL,
    /// Completed - random number has been generated
    COMPLETED,
}

/// Storage keys for the random number generator
#[contracttype]
pub enum DataKey {
    /// Admin address
    Admin,
    /// Current phase of the protocol
    CurrentPhase,
    /// Round ID counter
    RoundCounter,
    /// Commitment for a user in a specific round
    Commitment(u32, Address),
    /// Revealed secret from a user in a specific round
    Secret(u32, Address),
    /// Number of commits in a round
    CommitCount(u32),
    /// Number of reveals in a round
    RevealCount(u32),
    /// Minimum participants required
    MinParticipants,
    /// Final random seed for a round
    RandomSeed(u32),
    /// Whether the round is active
    RoundActive(u32),
}

#[contract]
pub struct RandomNumberGenerator;

#[contractimpl]
impl RandomNumberGenerator {
    /// Initialize the random number generator contract
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `admin` - Admin address
    /// * `min_participants` - Minimum number of participants required
    pub fn initialize(env: Env, admin: Address, min_participants: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::CurrentPhase, &Phase::COMMIT);
        env.storage().instance().set(&DataKey::RoundCounter, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::MinParticipants, &min_participants);
    }

    /// Start a new round for commit-reveal
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address starting the round (must be admin)
    ///
    /// # Returns
    /// The new round ID
    pub fn start_round(env: Env, caller: Address) -> u32 {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");

        assert!(caller == admin, "only admin can start rounds");

        let current_phase: Phase = env
            .storage()
            .instance()
            .get(&DataKey::CurrentPhase)
            .expect("phase not set");

        assert!(
            current_phase == Phase::COMMIT || current_phase == Phase::COMPLETED,
            "cannot start new round in current phase"
        );

        let counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RoundCounter)
            .unwrap_or(0);

        let new_round_id = counter + 1;

        env.storage()
            .instance()
            .set(&DataKey::RoundCounter, &new_round_id);
        env.storage()
            .instance()
            .set(&DataKey::CurrentPhase, &Phase::COMMIT);
        env.storage()
            .instance()
            .set(&DataKey::RoundActive(new_round_id), &true);
        env.storage()
            .instance()
            .set(&DataKey::CommitCount(new_round_id), &0u32);
        env.storage()
            .instance()
            .set(&DataKey::RevealCount(new_round_id), &0u32);

        env.events().publish(
            (symbol_short!("round"), new_round_id),
            symbol_short!("started"),
        );

        new_round_id
    }

    /// Commit a hash of the secret value
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `user` - Address committing the value
    /// * `round_id` - Round ID
    /// * `commitment` - Hash of the secret value (32 bytes)
    ///
    /// # Panics
    /// Panics if:
    /// - Phase is not COMMIT
    /// - User has already committed in this round
    pub fn commit(env: Env, user: Address, round_id: u32, commitment: BytesN<32>) {
        user.require_auth();

        let current_phase: Phase = env
            .storage()
            .instance()
            .get(&DataKey::CurrentPhase)
            .expect("phase not set");

        assert!(current_phase == Phase::COMMIT, "not in commit phase");

        let round_active: bool = env
            .storage()
            .instance()
            .get(&DataKey::RoundActive(round_id))
            .unwrap_or(false);

        assert!(round_active, "round is not active");

        let has_committed = env
            .storage()
            .instance()
            .has(&DataKey::Commitment(round_id, user.clone()));

        assert!(!has_committed, "already committed in this round");

        env.storage()
            .instance()
            .set(&DataKey::Commitment(round_id, user.clone()), &commitment);

        let commit_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CommitCount(round_id))
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&DataKey::CommitCount(round_id), &(commit_count + 1));

        // Topic: event name + round_id (u32 scalar); user Address in data.
        env.events().publish(
            (symbol_short!("commit"), round_id),
            (user, commitment),
        );
        env.events()
            .publish((symbol_short!("commit"), round_id, user), commitment);
    }

    /// Move from commit phase to reveal phase
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address moving to reveal phase (must be admin)
    ///
    /// # Panics
    /// Panics if:
    /// - Caller is not admin
    /// - Current phase is not COMMIT
    /// - Minimum participants not reached
    pub fn start_reveal_phase(env: Env, caller: Address) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");

        assert!(caller == admin, "only admin can start reveal phase");

        let current_phase: Phase = env
            .storage()
            .instance()
            .get(&DataKey::CurrentPhase)
            .expect("phase not set");

        assert!(current_phase == Phase::COMMIT, "not in commit phase");

        let current_round: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RoundCounter)
            .expect("round counter not set");

        let commit_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CommitCount(current_round))
            .unwrap_or(0);

        let min_participants: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinParticipants)
            .expect("min participants not set");

        assert!(
            commit_count >= min_participants,
            "minimum participants not reached"
        );

        env.storage()
            .instance()
            .set(&DataKey::CurrentPhase, &Phase::REVEAL);

        env.events().publish(
            (symbol_short!("phase"), current_round),
            symbol_short!("reveal"),
        );
    }

    /// Reveal the secret value
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `user` - Address revealing the secret
    /// * `round_id` - Round ID
    /// * `secret` - The secret value that was committed
    ///
    /// # Panics
    /// Panics if:
    /// - Phase is not REVEAL
    /// - User did not commit in this round
    /// - User already revealed in this round
    /// - Secret doesn't match commitment
    pub fn reveal(env: Env, user: Address, round_id: u32, secret: Bytes) {
        user.require_auth();

        let current_phase: Phase = env
            .storage()
            .instance()
            .get(&DataKey::CurrentPhase)
            .expect("phase not set");

        assert!(current_phase == Phase::REVEAL, "not in reveal phase");

        let commitment: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::Commitment(round_id, user.clone()))
            .expect("no commitment found");

        let has_revealed = env
            .storage()
            .instance()
            .has(&DataKey::Secret(round_id, user.clone()));

        assert!(!has_revealed, "already revealed in this round");

        // Verify the secret matches the commitment
        let computed_hash = Self::hash_secret(&env, &secret);

        assert!(
            computed_hash == commitment,
            "secret does not match commitment"
        );

        env.storage()
            .instance()
            .set(&DataKey::Secret(round_id, user.clone()), &secret);

        let reveal_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RevealCount(round_id))
            .unwrap_or(0);

        env.storage()
            .instance()
            .set(&DataKey::RevealCount(round_id), &(reveal_count + 1));

        // Topic: event name + round_id (u32 scalar); user Address in data.
        env.events().publish(
            (symbol_short!("reveal"), round_id),
            user,
        );
    }

    /// Compute the final random seed by hashing all revealed secrets
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Address computing the seed (must be admin)
    /// * `participants` - List of participant addresses
    ///
    /// # Returns
    /// The computed random seed (32 bytes)
    ///
    /// # Panics
    /// Panics if:
    /// - Caller is not admin
    /// - Phase is not REVEAL
    /// - Not all participants have revealed
    pub fn compute_random_seed(
        env: Env,
        caller: Address,
        participants: soroban_sdk::Vec<Address>,
    ) -> BytesN<32> {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");

        assert!(caller == admin, "only admin can compute seed");

        let current_phase: Phase = env
            .storage()
            .instance()
            .get(&DataKey::CurrentPhase)
            .expect("phase not set");

        assert!(current_phase == Phase::REVEAL, "not in reveal phase");

        let current_round: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RoundCounter)
            .expect("round counter not set");

        let commit_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CommitCount(current_round))
            .unwrap_or(0);

        let reveal_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RevealCount(current_round))
            .unwrap_or(0);

        assert!(
            reveal_count == commit_count,
            "not all participants have revealed"
        );

        assert!(commit_count > 0, "no commitments in this round");

        // Combine all revealed secrets
        let mut combined = Bytes::new(&env);

        for participant in participants.iter() {
            let secret: Bytes = env
                .storage()
                .instance()
                .get(&DataKey::Secret(current_round, participant))
                .expect("secret not found for participant");

            combined.append(&secret);
        }

        // Hash the combined secrets to get the final random seed
        let random_seed = Self::hash_secret(&env, &combined);

        env.storage()
            .instance()
            .set(&DataKey::RandomSeed(current_round), &random_seed);

        env.storage()
            .instance()
            .set(&DataKey::CurrentPhase, &Phase::COMPLETED);

        env.events()
            .publish((symbol_short!("seed"), current_round), random_seed.clone());

        random_seed
    }

    /// Get the current phase
    pub fn get_phase(env: Env) -> Phase {
        env.storage()
            .instance()
            .get(&DataKey::CurrentPhase)
            .expect("phase not set")
    }

    /// Get the current round ID
    pub fn get_current_round(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::RoundCounter)
            .unwrap_or(0)
    }

    /// Get the random seed for a specific round
    pub fn get_random_seed(env: Env, round_id: u32) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::RandomSeed(round_id))
    }

    /// Get commit count for a round
    pub fn get_commit_count(env: Env, round_id: u32) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::CommitCount(round_id))
            .unwrap_or(0)
    }

    /// Get reveal count for a round
    pub fn get_reveal_count(env: Env, round_id: u32) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::RevealCount(round_id))
            .unwrap_or(0)
    }

    /// Hash a secret value using SHA256
    fn hash_secret(env: &Env, secret: &Bytes) -> BytesN<32> {
        env.crypto().sha256(secret).into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, RandomNumberGeneratorClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(RandomNumberGenerator, ());
        let client = RandomNumberGeneratorClient::new(&env, &contract_id);
        client.initialize(&admin, &2u32);
        (env, client, admin)
    }

    #[test]
    fn test_initialize() {
        let (_, client, _admin) = setup();
        assert_eq!(client.get_phase(), Phase::COMMIT);
        assert_eq!(client.get_current_round(), 0);
    }

    #[test]
    fn test_start_round() {
        let (_, client, admin) = setup();
        let round_id = client.start_round(&admin);
        assert_eq!(round_id, 1);
        assert_eq!(client.get_current_round(), 1);
    }

    #[test]
    fn test_commit_and_reveal_flow() {
        let (env, client, admin) = setup();

        client.start_round(&admin);

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        let secret1 = Bytes::from_array(&env, &[1u8, 2, 3, 4]);
        let secret2 = Bytes::from_array(&env, &[5u8, 6, 7, 8]);

        let commitment1: BytesN<32> = env.crypto().sha256(&secret1).into();
        let commitment2: BytesN<32> = env.crypto().sha256(&secret2).into();

        client.commit(&user1, &1, &commitment1);
        client.commit(&user2, &1, &commitment2);

        assert_eq!(client.get_commit_count(&1), 2);

        client.start_reveal_phase(&admin);
        assert_eq!(client.get_phase(), Phase::REVEAL);

        client.reveal(&user1, &1, &secret1);
        client.reveal(&user2, &1, &secret2);

        assert_eq!(client.get_reveal_count(&1), 2);
    }
}
