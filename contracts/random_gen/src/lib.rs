#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Phase {
    Commit,
    Reveal,
    Finished,
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
}

#[contract]
pub struct RandomGen;

#[contractimpl]
impl RandomGen {
    /// Initialize the contract with an admin and the minimum number of participants.
    pub fn initialize(env: Env, admin: Address, min_commits: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::MinCommits, &min_commits);
        env.storage().instance().set(&DataKey::Phase, &Phase::Commit);
        
        let committers: Vec<Address> = Vec::new(&env);
        env.storage().instance().set(&DataKey::Committers, &committers);
    }

    /// Phase 1: Users commit a hash of their secret.
    pub fn commit(env: Env, user: Address, hash: BytesN<32>) {
        user.require_auth();
        
        let phase: Phase = env.storage().instance().get(&DataKey::Phase).unwrap_or(Phase::Commit);
        if phase != Phase::Commit {
            panic!("not in commit phase");
        }

        let commit_key = DataKey::Commit(user.clone());
        if env.storage().persistent().has(&commit_key) {
            panic!("already committed");
        }

        env.storage().persistent().set(&commit_key, &hash);

        let mut committers: Vec<Address> = env.storage().instance().get(&DataKey::Committers).unwrap();
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

    /// Phase 2: Users reveal their secrets.
    pub fn reveal(env: Env, user: Address, secret: BytesN<32>) {
        user.require_auth();

        let phase: Phase = env.storage().instance().get(&DataKey::Phase).expect("no phase");
        if phase != Phase::Reveal {
            panic!("not in reveal phase");
        }

        let commit_key = DataKey::Commit(user.clone());
        let hash: BytesN<32> = env.storage().persistent().get(&commit_key).expect("no commitment found");

        // Verify the secret
        let actual_hash: BytesN<32> = env.crypto().sha256(&secret.clone().into()).into();
        if actual_hash != hash {
            panic!("invalid secret");
        }

        let reveal_key = DataKey::Reveal(user.clone());
        if env.storage().persistent().has(&reveal_key) {
            panic!("already revealed");
        }

        env.storage().persistent().set(&reveal_key, &secret);

        // Emit event
        env.events().publish(
            (symbol_short!("reveal"), user),
            secret,
        );
    }

    /// Finalize the generation of the random seed.
    /// This can be called by anyone once all (or enough) secrets are revealed.
    pub fn finalize(env: Env) -> BytesN<32> {
        let phase: Phase = env.storage().instance().get(&DataKey::Phase).expect("no phase");
        if phase != Phase::Reveal {
            panic!("not in reveal phase");
        }

        let committers: Vec<Address> = env.storage().instance().get(&DataKey::Committers).unwrap();
        let mut seed = [0u8; 32];
        let mut reveal_count = 0;

        for user in committers.iter() {
            let reveal_key = DataKey::Reveal(user.clone());
            if let Some(secret) = env.storage().persistent().get::<_, BytesN<32>>(&reveal_key) {
                let secret_bytes = secret.to_array();
                for i in 0..32 {
                    seed[i] ^= secret_bytes[i];
                }
                reveal_count += 1;
            }
        }

        let min_commits: u32 = env.storage().instance().get(&DataKey::MinCommits).unwrap();
        if reveal_count < min_commits {
            panic!("not enough reveals");
        }

        let final_seed = BytesN::from_array(&env, &seed);
        env.storage().instance().set(&DataKey::RandomSeed, &final_seed);
        env.storage().instance().set(&DataKey::Phase, &Phase::Finished);

        // Emit final event
        env.events().publish(
            (symbol_short!("rng_fin"),),
            final_seed.clone(),
        );

        final_seed
    }

    /// Get the generated random seed.
    pub fn get_random_seed(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::RandomSeed).expect("seed not generated")
    }

    /// Get current phase
    pub fn get_phase(env: Env) -> Phase {
        env.storage().instance().get(&DataKey::Phase).unwrap_or(Phase::Commit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _};
    use soroban_sdk::{Env, BytesN};

    #[test]
    fn test_random_gen_flow() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let contract_id = env.register_contract(None, RandomGen);
        let client = RandomGenClient::new(&env, &contract_id);

        client.initialize(&admin, &2);

        let alice_secret = BytesN::from_array(&env, &[1u8; 32]);
        let alice_hash: BytesN<32> = env.crypto().sha256(&alice_secret.clone().into()).into();
        
        let bob_secret = BytesN::from_array(&env, &[2u8; 32]);
        let bob_hash: BytesN<32> = env.crypto().sha256(&bob_secret.clone().into()).into();

        client.commit(&alice, &alice_hash);
        assert_eq!(client.get_phase(), Phase::Commit);

        client.commit(&bob, &bob_hash);
        assert_eq!(client.get_phase(), Phase::Reveal);

        client.reveal(&alice, &alice_secret);
        client.reveal(&bob, &bob_secret);

        let seed = client.finalize();
        assert_eq!(client.get_phase(), Phase::Finished);

        let expected_seed_bytes = {
            let mut s = [0u8; 32];
            for i in 0..32 {
                s[i] = 1 ^ 2;
            }
            s
        };
        assert_eq!(seed.to_array(), expected_seed_bytes);
        assert_eq!(client.get_random_seed().to_array(), expected_seed_bytes);
    }
}
