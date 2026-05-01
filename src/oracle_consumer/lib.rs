#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal};

/// Standardized data structure for price, timestamp, and asset.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceData {
    pub asset: Address,
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    OracleAddress,
    PriceRecord(Address),
    Admin,
}

#[contract]
pub struct OracleConsumer;

#[contractimpl]
impl OracleConsumer {
    /// Initializes the consumer with an admin and the initial oracle source.
    pub fn initialize(env: Env, admin: Address, oracle: Address) {
        if env.storage().instance().has(&DataKey::OracleAddress) {
            panic!("already initialized");
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::OracleAddress, &oracle);
    }

    /// Pulls the latest price for a given asset from the configured external oracle.
    /// This updates the local storage with fresh data and returns it.
    pub fn update_price(env: Env, asset: Address) -> PriceData {
        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleAddress)
            .expect("oracle not set");

        // Attempt to call the external oracle's 'get_price' method.
        // The external oracle is expected to return the standardized PriceData structure.
        let price_info: PriceData = env.invoke_contract(
            &oracle,
            &symbol_short!("get_price"),
            (asset.clone(),).into_val(&env),
        );

        // Store the retrieved price record in the instance storage.
        env.storage()
            .instance()
            .set(&DataKey::PriceRecord(asset.clone()), &price_info);

        // Topic: event name only; asset + price in data.
        env.events()
            .publish(symbol_short!("price_upd"), (asset, price_info.price));

        price_info
    }

    /// Retrieves the most recent locally stored price for an asset.
    /// Includes a staleness check based on the provided `max_age_seconds`.
    pub fn get_latest_price(env: Env, asset: Address, max_age_seconds: u64) -> i128 {
        let price_info: PriceData = env
            .storage()
            .instance()
            .get(&DataKey::PriceRecord(asset))
            .expect("price record not found locally. call update_price first.");

        let current_time = env.ledger().timestamp();
        if current_time > price_info.timestamp + max_age_seconds {
            panic!("price record is too stale and cannot be used.");
        }

        price_info.price
    }

    /// Reconfigures the oracle source address. Restricted to the administrator.
    pub fn set_oracle(env: Env, new_oracle: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not configured");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::OracleAddress, &new_oracle);
    }

    /// Simple getter for the current oracle address.
    pub fn get_oracle(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::OracleAddress)
            .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_initialization() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);

        let contract_id = env.register(OracleConsumer, ());
        let client = OracleConsumerClient::new(&env, &contract_id);

        client.initialize(&admin, &oracle);
        assert_eq!(client.get_oracle(), oracle);
    }
}
