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
}

const DEFAULT_TWAP_WINDOW_SECONDS: u64 = 300;
const DEFAULT_MAX_PRICE_AGE_SECONDS: u64 = 600;
const DEFAULT_MAX_OBSERVATIONS: u32 = 24;
const DEFAULT_MAX_STALENESS_SECONDS: u64 = 300;

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
    SecondaryOracleAddress,
    PriceRecord(Address),
    PriceHistory(Address),
    Admin,
    DefaultTwapWindow,
    MaxPriceAge,
    MaxObservations,
    MaxStaleness,
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
    }

    /// Registers a secondary fallback oracle source. Restricted to the administrator.
    pub fn set_secondary_oracle(env: Env, new_oracle: Address) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::SecondaryOracleAddress, &new_oracle);
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
    

/* … truncated 4904 chars — edit only what you need near the top … */
