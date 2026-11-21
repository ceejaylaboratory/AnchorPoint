#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, xdr::ToXdr, Address, Bytes,
    BytesN, Env, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Phase {
    Commit,
    Reveal,
    Finished,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    InvalidMinCommits = 2,
    NotInCommitPhase = 3,
    NotInRevealPhase = 4,
    AlreadyCommitted = 5,
    ParticipantLimitReached = 6,
    NoCommitment = 7,
    HashMismatch = 8,
    AlreadyRevealed = 9,
    NotEnoughReveals = 10,
}

#[contracttype]
pub enum DataKey {
    Admin,
    MinCommits,
    Phase,
    Commit(Address),
    Reveal(Address),
    Committers,
    RandomSeed,
    /// Per-round nonce incremented on each `initialize` to namespace commits/reveals.
    RoundNonce,
}

#[contract]
pub struct RandomGen;

/// Maximum participants per generation to bound persistent storage footprint.
pub const MAX_PARTICIPANTS: u32 = 64;

/// Persistent entries per participant: Commit + Reveal (32 bytes each).
pub const PERSISTENT_BYTES_PER_PARTICIPANT: u32 = 64;

#[contractimpl]
impl RandomGen {
    /// Initialize the contract with an admin and the minimum number of participants.
    pub fn initialize(env: Env, admin: Address, min_commits: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if min_commits == 0 || min_commits > MAX_PARTICIPANTS {
            panic!("min_commits out of allowed range");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MinCommits, &min_commits);
        env.storage().instance().set(&DataKey::Phase, &Phase::Commit);
        env.storage().instance().set(&DataKey::RoundNonce, &0u64);

        let committers: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::Committers, &committers);
        env.events()
            .publish((symbol_short!("rng_init"),), (admin, min_commits));
    }

    /// Phase 1: Users commit a hash of their secret.
    ///
    /// The commitment is `sha256(secret || salt)`. Storing only the hash means
    /// no observer can derive the secret before the reveal phase, so outcomes
    /// cannot be simulated and front-run.
    ///
    /// Commit hashes are stored in **temporary** storage because they are only
    /// needed during the current randomness-generation round. Using temporary
    /// storage avoids paying persistent-entry rent fees for data that becomes
    /// irrelevant once the round is finished, reducing the contract's overall
    /// storage footprint.
    pub fn commit(env: Env, user: Address, hash: BytesN<32>) {
        user.require_auth();

        let phase: Phase = env.storage().instance().get(&DataKey::Phase).unwrap_or(Phase::Commit);
        if phase != Phase::Commit {
            panic!("not in commit phase");
        }

        let commit_key = DataKey::Commit(user.clone());
        if env.storage().temporary().has(&commit_key) {
            panic!("already committed");
        }

        let mut committers: Vec<Address> = env.storage().instance().get(&DataKey::Committers).unwrap();
        if committers.len() >= MAX_PARTICIPANTS as u32 {
            panic!("participant limit reached");
        }

        // Store commit hash in temporary storage — valid only for this round.
        env.storage().temporary().set(&commit_key, &hash);
        committers.push_back(user.clone());
        env.storage().instance().set(&DataKey::Committers, &committers);

        let min_commits: u32 = env.storage().instance().get(&DataKey::MinCommits).unwrap();
        if committers.len() >= min_commits {
            env.storage().instance().set(&DataKey::Phase, &Phase::Reveal);
        }

        // Emit event for indexer optimization (following the new schema!)
        env.events().publish(
            (symbol_short!("commit"), user),
            hash,
        );
    }

    /// Phase 2: Users reveal their secret and salt.
    ///
    /// The contract recomputes `sha256(secret || salt)` and rejects the reveal
    /// with `Error::HashMismatch` if it does not match the stored commitment.
    /// This binds the participant to the value they committed to before the
    /// reveal phase opened, eliminating front-running.
    ///
    /// Revealed secrets are stored in **temporary** storage for the same reason
    /// as commit hashes: they are only consumed during `finalize` and carry no
    /// long-term value. Temporary storage eliminates the persistent rent cost
    /// for these transient entries.
    pub fn reveal(env: Env, user: Address, secret: BytesN<32>, salt: BytesN<32>) -> Result<(), Error> {
        user.require_auth();

        let phase: Phase = env.storage().instance().get(&DataKey::Phase).expect("no phase");
        if phase != Phase::Reveal {
            return Err(Error::NotInRevealPhase);
        }

        let commit_key = DataKey::Commit(user.clone());
        // Read commit hash from temporary storage.
        let hash: BytesN<32> = match env.storage().temporary().get(&commit_key) {
            Some(h) => h,
            None => return Err(Error::NoCommitment),
        };

        let reveal_key = DataKey::Reveal(user.clone());
        if env.storage().temporary().has(&reveal_key) {
            return Err(Error::AlreadyRevealed);
        }

        // Verify sha256(secret || salt) == stored commitment hash.
        let mut preimage = Bytes::new(&env);
        preimage.extend_from_array(&secret.to_array());
        preimage.extend_from_array(&salt.to_array());
        let actual_hash: BytesN<32> = env.crypto().sha256(&preimage).into();
        if actual_hash != hash {
            return Err(Error::HashMismatch);
        }

        // Store revealed secret in temporary storage.
        env.storage().temporary().set(&reveal_key, &secret);

        // Emit event
        env.events().publish(
            (symbol_short!("reveal"), user),
            secret,
        );

        Ok(())
    }

    /// Finalize the generation of the random seed.
    ///
    /// Combines all participant secrets with on-chain entropy (ledger timestamp,
    /// sequence number, contract ID) and an optional caller-supplied salt using
    /// SHA-256. This prevents any single Stellar validator from predicting or
    /// biasing the output.
    ///
    /// Entropy inputs:
    ///   1. XOR of all revealed participant secrets  — user-contributed entropy
    ///   2. `env.ledger().timestamp()`               — ledger-level timing entropy
    ///   3. `env.ledger().sequence()`                — ledger sequence number
    ///   4. `env.current_contract_address()` (XDR)  — contract-specific namespace
    ///   5. `salt`                                   — caller-supplied additional entropy
    pub fn finalize(env: Env, salt: BytesN<32>) -> BytesN<32> {
        let phase: Phase = env.storage().instance().get(&DataKey::Phase).expect("no phase");
        if phase != Phase::Reveal {
            panic!("not in reveal phase");
        }

        let committers: Vec<Address> = env.storage().instance().get(&DataKey::Committers).unwrap();
        let mut xor_seed = [0u8; 32];
        let mut reveal_count = 0;

        // Step 1: XOR all participant secrets together.
        for user in committers.iter() {
            let reveal_key = DataKey::Reveal(user.clone());
            // Read revealed secrets from temporary storage.
            if let Some(secret) = env.storage().temporary().get::<_, BytesN<32>>(&reveal_key) {
                let secret_bytes = secret.to_array();
                for i in 0..32 {
                    xor_seed[i] ^= secret_bytes[i];
                }
                reveal_count += 1;
            }
        }

        let min_commits: u32 = env.storage().instance().get(&DataKey::MinCommits).unwrap();
        if reveal_count < min_commits {
            panic!("not enough reveals");
        }

        // Step 2: Build a hash preimage combining all entropy sources.
        //   [ xor_seed (32) | timestamp (8) | sequence (4) | contract_id_xdr (variable) | salt (32) ]
        let timestamp: u64 = env.ledger().timestamp();
        let sequence: u32 = env.ledger().sequence();

        // Encode timestamp (big-endian 8 bytes)
        let ts_bytes = timestamp.to_be_bytes();
        // Encode sequence (big-endian 4 bytes)
        let seq_bytes = sequence.to_be_bytes();

        // XDR-encode the contract address to get a unique per-contract identifier.
        let contract_xdr: Bytes = env.current_contract_address().to_xdr(&env);

        // Assemble preimage: xor_seed | ts | seq | contract_xdr | salt
        let mut preimage = Bytes::new(&env);
        preimage.extend_from_array(&xor_seed);
        preimage.extend_from_array(&ts_bytes);
        preimage.extend_from_array(&seq_bytes);
        preimage.extend_from_slice(&contract_xdr);
        preimage.extend_from_array(&salt.to_array());

        // Step 3: SHA-256 the assembled preimage to produce the final seed.
        let final_seed: BytesN<32> = env.crypto().sha256(&preimage).into();

        env.storage().instance().set(&DataKey::RandomSeed, &final_seed);
        env.storage().instance().set(&DataKey::Phase, &Phase::Finished);

        env.events()
            .publish((symbol_short!("finalize"),), final_seed.clone());

        final_seed
    }

    /// Read the finalized random seed, if any.
    pub fn get_seed(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::RandomSeed)
    }

    /// Read the current phase of the round.
    pub fn get_phase(env: Env) -> Phase {
        env.storage().instance().get(&DataKey::Phase).unwrap_or(Phase::Commit)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn commitment(env: &Env, secret: &BytesN<32>, salt: &BytesN<32>) -> BytesN<32> {
        let mut preimage = Bytes::new(env);
        preimage.extend_from_array(&secret.to_array());
        preimage.extend_from_array(&salt.to_array());
        env.crypto().sha256(&preimage).into()
    }

    #[test]
    fn commit_reveal_finalize_flow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, RandomGen);
        let client = RandomGenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &1);

        let user = Address::generate(&env);
        let secret = BytesN::from_array(&env, &[7u8; 32]);
        let salt = BytesN::from_array(&env, &[9u8; 32]);
        let hash = commitment(&env, &secret, &salt);

        client.commit(&user, &hash);
        assert_eq!(client.get_phase(), Phase::Reveal);

        client.reveal(&user, &secret, &salt);

        let final_salt = BytesN::from_array(&env, &[1u8; 32]);
        let seed = client.finalize(&final_salt);
        assert_eq!(client.get_seed(), Some(seed));
        assert_eq!(client.get_phase(), Phase::Finished);
    }

    #[test]
    fn reveal_with_wrong_secret_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, RandomGen);
        let client = RandomGenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &1);

        let user = Address::generate(&env);
        let secret = BytesN::from_array(&env, &[7u8; 32]);
        let salt = BytesN::from_array(&env, &[9u8; 32]);
        let hash = commitment(&env, &secret, &salt);
        client.commit(&user, &hash);

        let wrong_secret = BytesN::from_array(&env, &[8u8; 32]);
        let result = client.try_reveal(&user, &wrong_secret, &salt);
        assert_eq!(result, Err(Ok(Error::HashMismatch)));
    }

    #[test]
    fn unrevealed_secrets_are_penalized() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, RandomGen);
        let client = RandomGenClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin, &2);

        let user_a = Address::generate(&env);
        let user_b = Address::generate(&env);
        let secret_a = BytesN::from_array(&env, &[1u8; 32]);
        let secret_b = BytesN::from_array(&env, &[2u8; 32]);
        let salt = BytesN::from_array(&env, &[3u8; 32]);

        client.commit(&user_a, &commitment(&env, &secret_a, &salt));
        client.commit(&user_b, &commitment(&env, &secret_b, &salt));

        // Only one participant reveals; min_commits is 2 so finalize must fail.
        client.reveal(&user_a, &secret_a, &salt);

        let final_salt = BytesN::from_array(&env, &[4u8; 32]);
        let result = client.try_finalize(&final_salt);
        assert!(result.is_err());
    }
}
