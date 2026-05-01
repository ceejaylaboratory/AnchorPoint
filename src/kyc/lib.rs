#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, xdr::ToXdr, Address, Bytes, BytesN, Env,
};

#[contracttype]
pub enum DataKey {
    Admin,
    VerifierPubKey,
    UserKyc(Address), // ExpiresAt (u64)
}

#[contract]
pub struct KycVerifier;

#[contractimpl]
impl KycVerifier {
    pub fn initialize(env: Env, admin: Address, verifier_pubkey: BytesN<32>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerifierPubKey, &verifier_pubkey);
    }

    pub fn set_kyc_status(env: Env, user: Address, signature: BytesN<64>, expires_at: u64) {
        // KYC provider signs: user_addr + expires_at
        let current_time = env.ledger().timestamp();
        assert!(expires_at > current_time, "proof expired");

        let mut data = Bytes::new(&env);
        data.append(&user.clone().to_xdr(&env));
        data.append(&Bytes::from_slice(
            &env,
            &(expires_at as u128).to_be_bytes(),
        )); // Example message data

        // In real cases, we'd hash the data or use a specific format.
        // For simplicity, let's verify ed25519 signature.
        let pubkey: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::VerifierPubKey)
            .unwrap();

        env.crypto().ed25519_verify(&pubkey, &data, &signature);

        env.storage()
            .persistent()
            .set(&DataKey::UserKyc(user.clone()), &expires_at);
        // Topic: event name only; user + expires_at in data.
        env.events()
            .publish(symbol_short!("kyc_set"), (user, expires_at));
    }

    pub fn is_kyc_valid(env: Env, user: Address) -> bool {
        let current_time = env.ledger().timestamp();
        match env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::UserKyc(user))
        {
            Some(expiry) => expiry > current_time,
            None => false,
        }
    }

    pub fn update_verifier(env: Env, new_pubkey: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::VerifierPubKey, &new_pubkey);
    }

    pub fn revoke_kyc(env: Env, user: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let key = DataKey::UserKyc(user.clone());

        if !env.storage().persistent().has(&key) {
            panic!("no KYC record found for user");
        }

        env.storage().persistent().remove(&key);

        env.events()
            .publish((symbol_short!("kyc_rev"), user), ());
    }
}

#[cfg(test)]
mod tests;