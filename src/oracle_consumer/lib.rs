#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Vec};

const DEFAULT_TWAP_WINDOW_SECONDS: u64 = 300;
const DEFAULT_MAX_PRICE_AGE_SECONDS: u64 = 600;
const DEFAULT_MAX_OBSERVATIONS: u32 = 24;

/// Standardized data structure for price, timestamp, and asset.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub asset: Address,
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    OracleAddress,
    PriceRecord(Address),
    PriceHistory(Address),
    Admin,
    DefaultTwapWindow,
    MaxPriceAge,
    MaxObservations,
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
        env.storage()
            .instance()
            .set(&DataKey::DefaultTwapWindow, &DEFAULT_TWAP_WINDOW_SECONDS);
        env.storage()
            .instance()
            .set(&DataKey::MaxPriceAge, &DEFAULT_MAX_PRICE_AGE_SECONDS);
        env.storage()
            .instance()
            .set(&DataKey::MaxObservations, &DEFAULT_MAX_OBSERVATIONS);
    }

    /// Pulls the latest price for a given asset from the configured external oracle.
    /// This updates the local storage with fresh data, appends it to the local
    /// observation history used for TWAP calculation, and returns it.
    pub fn update_price(env: Env, asset: Address) -> PriceData {
        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleAddress)
            .expect("oracle not set");

        let price_info: PriceData = env.invoke_contract(
            &oracle,
            &symbol_short!("get_price"),
            (asset.clone(),).into_val(&env),
        );

        assert!(price_info.asset == asset, "oracle returned mismatched asset");
        assert!(price_info.price > 0, "oracle returned non-positive price");

        env.storage()
            .instance()
            .set(&DataKey::PriceRecord(asset.clone()), &price_info);
        Self::store_observation(&env, asset.clone(), price_info.clone());

        // Topic: event name only; asset + price in data.
        env.events()
            .publish(symbol_short!("price_upd"), (asset, price_info.price));

        price_info
    }

    /// Retrieves the most recent locally stored spot price for an asset.
    /// Includes a staleness check based on the provided `max_age_seconds`.
    pub fn get_latest_price(env: Env, asset: Address, max_age_seconds: u64) -> i128 {
        let price_info = Self::get_price_record(&env, asset);
        Self::assert_not_stale(&env, price_info.timestamp, max_age_seconds);
        price_info.price
    }

    /// Returns the TWAP over the requested lookback window.
    ///
    /// The calculation uses piecewise-constant pricing between observations and
    /// requires history that reaches at or before the start of the requested
    /// window to avoid a single fresh update dominating the average.
    pub fn get_twap_price(
        env: Env,
        asset: Address,
        lookback_seconds: u64,
        max_age_seconds: u64,
    ) -> i128 {
        assert!(lookback_seconds > 0, "lookback window must be positive");

        let current_time = env.ledger().timestamp();
        if current_time > price_info.timestamp.checked_add(max_age_seconds).expect("timestamp overflow") {
            panic!("price record is too stale and cannot be used.");
        let latest = Self::get_price_record(&env, asset.clone());
        Self::assert_not_stale(&env, latest.timestamp, max_age_seconds);

        let window_start = current_time.saturating_sub(lookback_seconds);
        let history = Self::get_price_history(&env, asset);

        let mut covered = false;
        let mut weighted_sum: i128 = 0;

        for i in 0..history.len() {
            let observation = history.get(i).unwrap();
            let next_timestamp = if i + 1 < history.len() {
                history.get(i + 1).unwrap().timestamp
            } else {
                current_time
            };

            if observation.timestamp <= window_start {
                covered = true;
            }

            let interval_start = if observation.timestamp > window_start {
                observation.timestamp
            } else {
                window_start
            };
            let interval_end = if next_timestamp < current_time {
                next_timestamp
            } else {
                current_time
            };

            if interval_end > interval_start {
                weighted_sum = weighted_sum
                    .checked_add(
                        observation
                            .price
                            .checked_mul((interval_end - interval_start) as i128)
                            .expect("twap multiplication overflow"),
                    )
                    .expect("twap accumulation overflow");
            }
        }

        assert!(
            covered,
            "insufficient price history for requested twap window"
        );

        weighted_sum / lookback_seconds as i128
    }

    /// Default consumer-facing price read.
    ///
    /// This returns the configured TWAP instead of the latest spot price so
    /// downstream contracts can consume a manipulation-resistant value.
    pub fn get_price(env: Env, asset: Address) -> i128 {
        let lookback: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DefaultTwapWindow)
            .unwrap_or(DEFAULT_TWAP_WINDOW_SECONDS);
        let max_age: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxPriceAge)
            .unwrap_or(DEFAULT_MAX_PRICE_AGE_SECONDS);

        Self::get_twap_price(env, asset, lookback, max_age)
    }

    /// Reconfigures the oracle source address. Restricted to the administrator.
    pub fn set_oracle(env: Env, new_oracle: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::OracleAddress, &new_oracle);
    }

    /// Updates the default TWAP lookback window. Restricted to the administrator.
    pub fn set_twap_window(env: Env, lookback_seconds: u64) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        assert!(lookback_seconds > 0, "lookback window must be positive");
        env.storage()
            .instance()
            .set(&DataKey::DefaultTwapWindow, &lookback_seconds);
    }

    /// Updates the maximum acceptable age for the latest observation used by TWAP.
    pub fn set_max_price_age(env: Env, max_age_seconds: u64) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        assert!(max_age_seconds > 0, "max price age must be positive");
        env.storage()
            .instance()
            .set(&DataKey::MaxPriceAge, &max_age_seconds);
    }

    /// Caps the number of stored observations per asset. Restricted to the administrator.
    pub fn set_max_observations(env: Env, max_observations: u32) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        assert!(max_observations > 1, "max observations must exceed one");
        env.storage()
            .instance()
            .set(&DataKey::MaxObservations, &max_observations);
    }

    /// Simple getter for the current oracle address.
    pub fn get_oracle(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::OracleAddress)
            .unwrap()
    }

    pub fn get_default_twap_window(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::DefaultTwapWindow)
            .unwrap_or(DEFAULT_TWAP_WINDOW_SECONDS)
    }

    pub fn get_max_price_age(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MaxPriceAge)
            .unwrap_or(DEFAULT_MAX_PRICE_AGE_SECONDS)
    }

    pub fn get_max_observations(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::MaxObservations)
            .unwrap_or(DEFAULT_MAX_OBSERVATIONS)
    }

    pub fn get_observation_count(env: Env, asset: Address) -> u32 {
        Self::get_price_history(&env, asset).len()
    }

    fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not configured")
    }

    fn get_price_record(env: &Env, asset: Address) -> PriceData {
        env.storage()
            .instance()
            .get(&DataKey::PriceRecord(asset))
            .expect("price record not found locally. call update_price first.")
    }

    fn get_price_history(env: &Env, asset: Address) -> Vec<PriceData> {
        env.storage()
            .instance()
            .get(&DataKey::PriceHistory(asset))
            .unwrap_or_else(|| Vec::new(env))
    }

    fn store_observation(env: &Env, asset: Address, observation: PriceData) {
        let max_observations: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxObservations)
            .unwrap_or(DEFAULT_MAX_OBSERVATIONS);

        let mut history = Self::get_price_history(env, asset.clone());
        let last_timestamp = if history.len() > 0 {
            Some(history.get(history.len() - 1).unwrap().timestamp)
        } else {
            None
        };

        if let Some(timestamp) = last_timestamp {
            assert!(
                observation.timestamp >= timestamp,
                "oracle timestamps must be non-decreasing"
            );
            if observation.timestamp == timestamp {
                history.set(history.len() - 1, observation);
                env.storage()
                    .instance()
                    .set(&DataKey::PriceHistory(asset), &history);
                return;
            }
        }

        history.push_back(observation);
        while history.len() > max_observations {
            history.remove(0);
        }

        env.storage()
            .instance()
            .set(&DataKey::PriceHistory(asset), &history);
    }

    fn assert_not_stale(env: &Env, timestamp: u64, max_age_seconds: u64) {
        let current_time = env.ledger().timestamp();
        if current_time > timestamp.saturating_add(max_age_seconds) {
            panic!("price record is too stale and cannot be used.");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    #[contract]
    struct MockOracle;

    #[contracttype]
    enum MockOracleDataKey {
        Price(Address),
    }

    #[contractimpl]
    impl MockOracle {
        pub fn set_price(env: Env, asset: Address, price: i128, timestamp: u64) {
            let price_data = PriceData {
                asset: asset.clone(),
                price,
                timestamp,
            };
            env.storage()
                .instance()
                .set(&MockOracleDataKey::Price(asset), &price_data);
        }

        pub fn get_price(env: Env, asset: Address) -> PriceData {
            env.storage()
                .instance()
                .get(&MockOracleDataKey::Price(asset))
                .expect("missing mock price")
        }
    }

    fn set_ledger_time(env: &Env, timestamp: u64) {
        let mut ledger = env.ledger().get();
        ledger.timestamp = timestamp;
        env.ledger().set(ledger);
    }

    fn setup() -> (Env, OracleConsumerClient<'static>, Address, MockOracleClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let oracle_id = env.register(MockOracle, ());
        let oracle = MockOracleClient::new(&env, &oracle_id);

        let contract_id = env.register(OracleConsumer, ());
        let client = OracleConsumerClient::new(&env, &contract_id);
        client.initialize(&admin, &oracle_id);

        (env, client, admin, oracle)
    }

    #[test]
    fn test_initialization() {
        let (_env, client, _admin, oracle) = setup();
        assert_eq!(client.get_oracle(), oracle.address.clone());
        assert_eq!(client.get_default_twap_window(), DEFAULT_TWAP_WINDOW_SECONDS);
        assert_eq!(client.get_max_price_age(), DEFAULT_MAX_PRICE_AGE_SECONDS);
        assert_eq!(client.get_max_observations(), DEFAULT_MAX_OBSERVATIONS);
    }

    #[test]
    fn test_get_latest_price_after_update() {
        let (env, client, _admin, oracle) = setup();
        let asset = Address::generate(&env);

        set_ledger_time(&env, 100);
        oracle.set_price(&asset, &1_000, &100);
        client.update_price(&asset);

        assert_eq!(client.get_latest_price(&asset, &10), 1_000);
        assert_eq!(client.get_observation_count(&asset), 1);
    }

    #[test]
    fn test_twap_uses_time_weighted_history() {
        let (env, client, _admin, oracle) = setup();
        let asset = Address::generate(&env);

        set_ledger_time(&env, 0);
        oracle.set_price(&asset, &100, &0);
        client.update_price(&asset);

        set_ledger_time(&env, 200);
        oracle.set_price(&asset, &100, &200);
        client.update_price(&asset);

        set_ledger_time(&env, 290);
        oracle.set_price(&asset, &200, &290);
        client.update_price(&asset);

        set_ledger_time(&env, 300);
        assert_eq!(client.get_twap_price(&asset, &300, &120), 103);
    }

    #[test]
    #[should_panic(expected = "insufficient price history for requested twap window")]
    fn test_twap_requires_full_window_coverage() {
        let (env, client, _admin, oracle) = setup();
        let asset = Address::generate(&env);

        set_ledger_time(&env, 250);
        oracle.set_price(&asset, &250, &250);
        client.update_price(&asset);

        set_ledger_time(&env, 300);
        client.get_twap_price(&asset, &300, &120);
    }

    #[test]
    fn test_default_get_price_returns_twap() {
        let (env, client, _admin, oracle) = setup();
        let asset = Address::generate(&env);

        client.set_twap_window(&60);
        client.set_max_price_age(&120);

        set_ledger_time(&env, 0);
        oracle.set_price(&asset, &100, &0);
        client.update_price(&asset);

        set_ledger_time(&env, 30);
        oracle.set_price(&asset, &100, &30);
        client.update_price(&asset);

        set_ledger_time(&env, 59);
        oracle.set_price(&asset, &1_000, &59);
        client.update_price(&asset);

        set_ledger_time(&env, 60);
        assert_eq!(client.get_price(&asset), 115);
        assert_eq!(client.get_default_twap_window(), 60);
        assert_eq!(client.get_max_price_age(), 120);

        let new_oracle_id = env.register(MockOracle, ());
        client.set_oracle(&new_oracle_id);
        assert_eq!(client.get_oracle(), new_oracle_id);
    }

    #[test]
    fn test_history_is_bounded_by_max_observations() {
        let (env, client, _admin, oracle) = setup();
        let asset = Address::generate(&env);

        client.set_max_observations(&3);

        for t in 0..4u64 {
            set_ledger_time(&env, t);
            oracle.set_price(&asset, &(100 + t as i128), &t);
            client.update_price(&asset);
        }

        assert_eq!(client.get_observation_count(&asset), 3);
    }
}
