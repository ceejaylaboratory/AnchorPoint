#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Vec};

/// Errors that can be returned by the Oracle Consumer contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Error {
    /// The price data returned by the oracle is older than the configured
    /// `MaxPriceAge` threshold and must not be used.
    StalePriceFeed = 1,
    /// The price data returned by the oracle is older than the configured
    /// `MaxStaleness` threshold and must not be used.
    OraclePriceStale = 2,
    /// Fewer than 2 ledger-sequence observations are stored; TWAP cannot be
    /// calculated without at least two data points.
    InsufficientObservations = 3,
}

const DEFAULT_TWAP_WINDOW_SECONDS: u64 = 300;
const DEFAULT_MAX_PRICE_AGE_SECONDS: u64 = 600;
const DEFAULT_MAX_OBSERVATIONS: u32 = 24;
const DEFAULT_MAX_STALENESS_SECONDS: u64 = 300;

/// Number of ledgers to extend the TTL of persistent TWAP observation storage.
/// ~30 days at ~5 s per ledger: 30 * 24 * 3600 / 5 = 518_400 ledgers.
const TWAP_OBSERVATIONS_TTL: u32 = 518_400;

/// Standardized data structure for price, timestamp, and asset.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub asset: Address,
    pub price: i128,
    pub timestamp: u64,
}

/// A single ledger-sequence price observation used for sequence-based TWAP.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LedgerObservation {
    /// The ledger sequence number at which the price was recorded.
    pub ledger: u32,
    /// The price recorded at that ledger.
    pub price: i128,
}

#[contracttype]
pub enum DataKey {
    OracleAddress,
    SecondaryOracleAddress,
    PriceRecord(Address),
    PriceHistory(Address),
    Admin,
    DefaultTwapWindow,
    MaxPriceAge,
    MaxObservations,
    MaxStaleness,
    /// Persistent storage for ledger-sequence TWAP observations per asset.
    LedgerObservations(Address),
}

#[contract]
pub struct OracleConsumer;

#[allow(deprecated)]
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
        env.storage()
            .instance()
            .set(&DataKey::MaxStaleness, &DEFAULT_MAX_STALENESS_SECONDS);
        env.events()
            .publish((symbol_short!("orcl_init"),), (admin, oracle));
    }

    /// Pulls the latest price for a given asset from the configured external oracle.
    /// This updates the local storage with fresh data, appends it to the local
    /// observation history used for TWAP calculation, and returns it.
    ///
    /// The primary oracle is attempted first. If it errors or returns stale data,
    /// the configured secondary oracle is used as a fallback and a fallback event
    /// is emitted.
    ///
    /// Returns [`Error::OraclePriceStale`] if the oracle-reported timestamp is
    /// older than the configured `MaxStaleness` threshold.
    pub fn update_price(env: Env, asset: Address) -> Result<PriceData, Error> {
        let max_staleness: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxStaleness)
            .unwrap_or(DEFAULT_MAX_STALENESS_SECONDS);

        let primary: Address = env
            .storage()
            .instance()
            .get(&DataKey::OracleAddress)
            .expect("oracle not set");

        let price_info = match Self::try_fetch_price(&env, &primary, &asset, max_staleness) {
            Ok(info) => info,
            Err(_) => {
                let secondary: Address = env
                    .storage()
                    .instance()
                    .get(&DataKey::SecondaryOracleAddress)
                    .expect("secondary oracle not set");

                let info = Self::try_fetch_price(&env, &secondary, &asset, max_staleness)?;

                // Topic: event name only; asset + source in data.
                env.events().publish(
                    (symbol_short!("oracle"), symbol_short!("fallback")),
                    (asset.clone(), secondary),
                );

                info
            }
        };

        env.storage()
            .instance()
            .set(&DataKey::PriceRecord(asset.clone()), &price_info);
        Self::store_observation(&env, asset.clone(), price_info.clone());

        // Topic: event name only; asset + price in data.
        env.events().publish(
            (symbol_short!("oracle"), symbol_short!("price_upd")),
            (asset, price_info.price),
        );

        Ok(price_info)
    }

    /// Fetches and validates a price from a single oracle source.
    ///
    /// Returns an error if the oracle-reported timestamp is stale so the caller
    /// can fall back to another source.
    fn try_fetch_price(
        env: &Env,
        oracle: &Address,
        asset: &Address,
        max_staleness: u64,
    ) -> Result<PriceData, Error> {
        let price_info: PriceData = env.invoke_contract(
            oracle,
            &symbol_short!("get_price"),
            (asset.clone(),).into_val(env),
        );

        assert!(
            price_info.asset == *asset,
            "oracle returned mismatched asset"
        );
        assert!(price_info.price > 0, "oracle returned non-positive price");

        Self::assert_not_stale(env, price_info.timestamp, max_staleness)?;

        Ok(price_info)
    }

    /// Retrieves the most recent locally stored spot price for an asset.
    /// Includes a staleness check based on the provided `max_age_seconds`.
    pub fn get_latest_price(
        env: Env,
        asset: Address,
        max_age_seconds: u64,
    ) -> Result<i128, Error> {
        let price_info = Self::get_price_record(&env, asset);
        Self::assert_not_stale(&env, price_info.timestamp, max_age_seconds)?;
        Ok(price_info.price)
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
    ) -> Result<i128, Error> {
        assert!(lookback_seconds > 0, "lookback window must be positive");

        let current_time = env.ledger().timestamp();
        let latest = Self::get_price_record(&env, asset.clone());
        Self::assert_not_stale(&env, latest.timestamp, max_age_seconds)?;

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

        Ok(weighted_sum / lookback_seconds as i128)
    }

    /// Default consumer-facing price read.
    ///
    /// This returns the configured TWAP instead of the latest spot price so
    /// downstream contracts can consume a manipulation-resistant value.
    pub fn get_price(env: Env, asset: Address) -> Result<i128, Error> {
        let lookback: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DefaultTwapWindow)
            .unwrap_or(DEFAULT_TWAP_WINDOW_SECONDS);
        let max_staleness: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxStaleness)
            .unwrap_or(DEFAULT_MAX_STALENESS_SECONDS);

        Self::get_twap_price(env, asset, lookback, max_staleness)
    }

    /// Reconfigures the oracle source address. Restricted to the administrator.
    pub fn set_oracle(env: Env, new_oracle: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::OracleAddress, &new_oracle);
        env.events()
            .publish((symbol_short!("orcl_set"), admin), new_oracle);
    }

    /// Registers a secondary fallback oracle source. Restricted to the administrator.
    pub fn set_secondary_oracle(env: Env, new_oracle: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::SecondaryOracleAddress, &new_oracle);
        env.events()
            .publish((symbol_short!("orcl2set"), admin), new_oracle);
    }

    /// Returns the configured secondary fallback oracle, if any.
    pub fn get_secondary_oracle(env: Env) -> Option<Address> {
        env.storage()
            .instance()
            .get(&DataKey::SecondaryOracleAddress)
    }

    /// Updates the default TWAP lookback window. Restricted to the administrator.
    pub fn set_twap_window(env: Env, lookback_seconds: u64) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        assert!(lookback_seconds > 0, "lookback window must be positive");
        env.storage()
            .instance()
            .set(&DataKey::DefaultTwapWindow, &lookback_seconds);
        env.events()
            .publish((symbol_short!("twap_set"), admin), lookback_seconds);
    }

    pub fn set_max_price_age(env: Env, max_age_seconds: u64) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        assert!(max_age_seconds > 0, "max price age must be positive");
        env.storage()
            .instance()
            .set(&DataKey::MaxPriceAge, &max_age_seconds);
        env.events()
            .publish((symbol_short!("age_set"), admin), max_age_seconds);
    }

    pub fn set_max_staleness(env: Env, max_staleness_seconds: u64) {
        let admin = Self::get_admin(&env);
        admin.require_auth();
        assert!(max_staleness_seconds > 0, "max staleness must be positive");
        env.storage()
            .instance()
            .set(&DataKey::MaxStaleness, &max_staleness_seconds);
        env.events()
            .publish((symbol_short!("stale_set"), admin), max_staleness_seconds);
    }

    pub fn get_max_staleness(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MaxStaleness)
            .unwrap_or(DEFAULT_MAX_STALENESS_SECONDS)
    }

    fn assert_not_stale(
        env: &Env,
        price_timestamp: u64,
        max_staleness_seconds: u64,
    ) -> Result<(), Error> {
        if env.ledger().timestamp().saturating_sub(price_timestamp) > max_staleness_seconds {
            return Err(Error::OraclePriceStale);
        }
        Ok(())
    }

    fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set")
    }

    fn get_price_record(env: &Env, asset: Address) -> PriceData {
        env.storage()
            .instance()
            .get(&DataKey::PriceRecord(asset))
            .expect("no price record for asset")
    }

    fn get_price_history(env: &Env, asset: Address) -> Vec<PriceData> {
        env.storage()
            .instance()
            .get(&DataKey::PriceHistory(asset))
            .unwrap_or(Vec::new(env))
    }

    fn store_observation(env: &Env, asset: Address, price_info: PriceData) {
        let mut history = Self::get_price_history(env, asset.clone());
        history.push_back(price_info);
        let max_observations: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxObservations)
            .unwrap_or(DEFAULT_MAX_OBSERVATIONS);
        while history.len() > max_observations {
            history.pop_front();
        }
        env.storage()
            .instance()
            .set(&DataKey::PriceHistory(asset), &history);
    }

    // -------------------------------------------------------------------------
    // Ledger-sequence TWAP: record_price / get_twap
    // -------------------------------------------------------------------------

    /// Record a price observation keyed by the current ledger sequence number.
    ///
    /// Observations are stored in persistent storage with a rolling TTL so they
    /// survive across ledger closures. At most `MaxObservations` entries are kept;
    /// the oldest is dropped when the cap is reached.
    ///
    /// This function is permissionless — any caller can push a new observation,
    /// which is appropriate because the caller supplies the price that is already
    /// validated upstream (e.g. by fetching from the oracle via `update_price`).
    pub fn record_price(env: Env, asset: Address, price: i128) {
        assert!(price > 0, "price must be positive");

        let current_ledger = env.ledger().sequence();
        let observation = LedgerObservation {
            ledger: current_ledger,
            price,
        };

        let key = DataKey::LedgerObservations(asset.clone());
        let mut observations: Vec<LedgerObservation> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        observations.push_back(observation);

        let max_obs: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxObservations)
            .unwrap_or(DEFAULT_MAX_OBSERVATIONS);

        // Drop the oldest observation when the cap is exceeded.
        while observations.len() > max_obs {
            observations.pop_front();
        }

        env.storage().persistent().set(&key, &observations);
        // Extend TTL so observations are not evicted between TWAP queries.
        env.storage()
            .persistent()
            .extend_ttl(&key, TWAP_OBSERVATIONS_TTL / 2, TWAP_OBSERVATIONS_TTL);

        env.events().publish(
            (symbol_short!("rec_price"),),
            (asset, current_ledger, price),
        );
    }

    /// Return the arithmetic mean price over the last `period_ledgers` ledgers.
    ///
    /// Only observations whose ledger sequence falls within
    /// `[current_ledger - period_ledgers, current_ledger]` are included.
    ///
    /// Returns [`Error::InsufficientObservations`] when fewer than 2 observations
    /// exist in the requested window (manipulation-resistance requires at least
    /// two independent data points).
    pub fn get_twap(env: Env, asset: Address, period_ledgers: u32) -> Result<i128, Error> {
        assert!(period_ledgers > 0, "period_ledgers must be positive");

        let current_ledger = env.ledger().sequence();
        let window_start = current_ledger.saturating_sub(period_ledgers);

        let key = DataKey::LedgerObservations(asset.clone());
        let observations: Vec<LedgerObservation> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        // Collect observations within the window.
        let mut sum: i128 = 0;
        let mut count: u32 = 0;
        for i in 0..observations.len() {
            let obs = observations.get(i).unwrap();
            if obs.ledger >= window_start && obs.ledger <= current_ledger {
                sum = sum
                    .checked_add(obs.price)
                    .expect("twap sum overflow");
                count += 1;
            }
        }

        if count < 2 {
            return Err(Error::InsufficientObservations);
        }

        Ok(sum / count as i128)
    }

    /// Returns the raw list of ledger-sequence observations stored for an asset.
    /// Useful for off-chain inspection and integration tests.
    pub fn get_ledger_observations(env: Env, asset: Address) -> Vec<LedgerObservation> {
        env.storage()
            .persistent()
            .get(&DataKey::LedgerObservations(asset))
            .unwrap_or_else(|| Vec::new(&env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Env,
    };

    fn setup(env: &Env) -> (Address, Address, OracleConsumerClient<'static>) {
        env.mock_all_auths();

        let admin = Address::generate(env);
        let oracle = Address::generate(env);
        let asset = Address::generate(env);

        let contract_id = env.register(OracleConsumer, ());
        let client = OracleConsumerClient::new(env, &contract_id);
        client.initialize(&admin, &oracle);

        (asset, admin, client)
    }

    // -------------------------------------------------------------------------
    // record_price / get_twap tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_record_price_stores_observation() {
        let env = Env::default();
        let (asset, _admin, client) = setup(&env);

        env.ledger().with_mut(|l| l.sequence_number = 100);
        client.record_price(&asset, &1_000);

        let obs = client.get_ledger_observations(&asset);
        assert_eq!(obs.len(), 1);
        assert_eq!(obs.get(0).unwrap().ledger, 100);
        assert_eq!(obs.get(0).unwrap().price, 1_000);
    }

    #[test]
    fn test_get_twap_returns_arithmetic_mean() {
        let env = Env::default();
        let (asset, _admin, client) = setup(&env);

        // Record three observations at different ledger heights.
        env.ledger().with_mut(|l| l.sequence_number = 100);
        client.record_price(&asset, &1_000);

        env.ledger().with_mut(|l| l.sequence_number = 110);
        client.record_price(&asset, &2_000);

        env.ledger().with_mut(|l| l.sequence_number = 120);
        client.record_price(&asset, &3_000);

        // Request TWAP over the last 30 ledgers (window_start = 90, all 3 in window).
        let twap = client.get_twap(&asset, &30).unwrap();
        // arithmetic mean of [1000, 2000, 3000] = 2000
        assert_eq!(twap, 2_000);
    }

    #[test]
    fn test_get_twap_excludes_observations_outside_window() {
        let env = Env::default();
        let (asset, _admin, client) = setup(&env);

        // Old observation, outside any 10-ledger window from ledger 120.
        env.ledger().with_mut(|l| l.sequence_number = 50);
        client.record_price(&asset, &500);

        // Recent observations inside window.
        env.ledger().with_mut(|l| l.sequence_number = 115);
        client.record_price(&asset, &1_000);

        env.ledger().with_mut(|l| l.sequence_number = 120);
        client.record_price(&asset, &3_000);

        // Window covers ledgers 110–120; only the two recent ones qualify.
        let twap = client.get_twap(&asset, &10).unwrap();
        // mean([1000, 3000]) = 2000
        assert_eq!(twap, 2_000);
    }

    #[test]
    fn test_get_twap_insufficient_observations_returns_error() {
        let env = Env::default();
        let (asset, _admin, client) = setup(&env);

        // Only 1 observation — must return InsufficientObservations.
        env.ledger().with_mut(|l| l.sequence_number = 100);
        client.record_price(&asset, &1_000);

        let result = client.try_get_twap(&asset, &50);
        assert_eq!(result, Err(Ok(Error::InsufficientObservations)));
    }

    #[test]
    fn test_get_twap_no_observations_returns_error() {
        let env = Env::default();
        let (asset, _admin, client) = setup(&env);

        // No observations at all.
        let result = client.try_get_twap(&asset, &50);
        assert_eq!(result, Err(Ok(Error::InsufficientObservations)));
    }

    #[test]
    fn test_record_price_drops_oldest_when_cap_reached() {
        let env = Env::default();
        let (asset, _admin, client) = setup(&env);

        // Default cap is 24 observations. Record 25.
        for i in 0u32..25 {
            env.ledger().with_mut(|l| l.sequence_number = 100 + i);
            client.record_price(&asset, &(i as i128 + 1) * 100);
        }

        let obs = client.get_ledger_observations(&asset);
        // Cap enforced: exactly 24 entries remain.
        assert_eq!(obs.len(), 24);
        // The oldest entry (ledger=100, price=100) must have been dropped.
        assert_eq!(obs.get(0).unwrap().ledger, 101);
    }

    #[test]
    #[should_panic(expected = "price must be positive")]
    fn test_record_price_rejects_non_positive() {
        let env = Env::default();
        let (asset, _admin, client) = setup(&env);

        env.ledger().with_mut(|l| l.sequence_number = 100);
        client.record_price(&asset, &0);
    }
}
