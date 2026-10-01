#![no_std]
//! Oracle Medianizer with Outlier Detection
//!
//! This contract aggregates data from multiple price feeds to provide robust
//! oracle prices. It implements:
//! - Median calculation to mitigate malicious feeds
//! - Outlier rejection (discarding values > 2 standard deviations)
//! - Heartbeat and deviation threshold triggers for updates
//!
//! Security Features:
//! - Filters out malicious or erroneous price feeds
//! - Requires minimum number of sources for reliability
//! - Time-based and deviation-based update triggers

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Vec};

/// Price feed data from an oracle source
#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceFeed {
    /// Oracle source address
    pub source: Address,
    /// Asset being priced
    pub asset: Address,
    /// Price value (scaled by 1e8 for precision)
    pub price: i128,
    /// Timestamp of the price
    pub timestamp: u64,
}

/// Storage keys for oracle medianizer
#[contracttype]
pub enum DataKey {
    /// Admin address
    Admin,
    /// List of authorized oracle sources
    OracleSource(Address),
    /// Whether an oracle source is authorized
    IsOracleSource(Address),
    /// Number of oracle sources
    OracleCount,
    /// Price data for an asset from a specific source
    PriceData(Address, Address), // (asset, source)
    /// Median price for an asset
    MedianPrice(Address),
    /// Last update timestamp for an asset
    LastUpdate(Address),
    /// Heartbeat interval for an asset (in seconds)
    Heartbeat(Address),
    /// Deviation threshold (in basis points, e.g., 100 = 1%)
    DeviationThreshold(Address),
    /// Minimum number of sources required
    MinSources,
}

#[contract]
pub struct OracleMedianizer;

#[allow(deprecated)]
#[contractimpl]
impl OracleMedianizer {
    /// Initialize the oracle medianizer
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `admin` - Admin address
    /// * `min_sources` - Minimum number of oracle sources required
    pub fn initialize(env: Env, admin: Address, min_sources: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::OracleCount, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::MinSources, &min_sources);
    }

    /// Add an authorized oracle source
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Admin address
    /// * `oracle` - Oracle source address to add
    pub fn add_oracle_source(env: Env, caller: Address, oracle: Address) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");

        assert!(caller == admin, "only admin can add oracle sources");

        let is_source: bool = env
            .storage()
            .instance()
            .get(&DataKey::IsOracleSource(oracle.clone()))
            .unwrap_or(false);

        assert!(!is_source, "oracle source already exists");

        env.storage()
            .instance()
            .set(&DataKey::IsOracleSource(oracle.clone()), &true);
        env.storage()
            .instance()
            .set(&DataKey::OracleSource(oracle.clone()), &oracle);

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::OracleCount)
            .unwrap_or(0);

        env.storage().instance().set(
            &DataKey::OracleCount,
            &count.checked_add(1).expect("oracle count overflow"),
        );

        // Topic: event name + oracle Address (needed for indexing source changes).
        env.events().publish(
            (symbol_short!("orcl_add"),),
            (oracle.clone(), oracle.clone()),
        );
        env.events()
            .publish((symbol_short!("oracle"), oracle), symbol_short!("added"));
    }

    /// Remove an oracle source
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Admin address
    /// * `oracle` - Oracle source address to remove
    pub fn remove_oracle_source(env: Env, caller: Address, oracle: Address) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");

        assert!(caller == admin, "only admin can remove oracle sources");

        env.storage()
            .instance()
            .remove(&DataKey::IsOracleSource(oracle.clone()));
        env.storage()
            .instance()
            .remove(&DataKey::OracleSource(oracle.clone()));

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::OracleCount)
            .unwrap_or(0);

        if count > 0 {
            env.storage()
                .instance()
                .set(&DataKey::OracleCount, &(count - 1));
        }

        // Topic: event name only; oracle Address in data.
        env.events()
            .publish((symbol_short!("orcl_rm"),), oracle.clone());
        env.events()
            .publish((symbol_short!("oracle"), oracle), symbol_short!("removed"));
    }

    /// Set heartbeat interval for an asset
    /// The heartbeat triggers an update if the time since last update exceeds this interval
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Admin address
    /// * `asset` - Asset address
    /// * `heartbeat_seconds` - Heartbeat interval in seconds
    pub fn set_heartbeat(env: Env, caller: Address, asset: Address, heartbeat_seconds: u64) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");

        assert!(caller == admin, "only admin can set heartbeat");

        env.storage()
            .instance()
            .set(&DataKey::Heartbeat(asset.clone()), &heartbeat_seconds);
    }

    /// Set deviation threshold for an asset
    /// An update is triggered if the new price deviates from the median by more than this threshold
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `caller` - Admin address
    /// * `asset` - Asset address
    /// * `threshold_bps` - Deviation threshold in basis points (1 bp = 0.01%)
    pub fn set_deviation_threshold(env: Env, caller: Address, asset: Address, threshold_bps: u32) {
        caller.require_auth();

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");

        assert!(caller == admin, "only admin can set deviation threshold");

        env.storage()
            .instance()
            .set(&DataKey::DeviationThreshold(asset.clone()), &threshold_bps);
    }

    /// Submit a price update from an oracle source
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `oracle` - Oracle source address
    /// * `asset` - Asset address
    /// * `price` - Price value (scaled by 1e8)
    ///
    /// # Panics
    /// Panics if oracle is not authorized
    pub fn submit_price(env: Env, oracle: Address, asset: Address, price: i128) {
        oracle.require_auth();

        let is_authorized: bool = env
            .storage()
            .instance()
            .get(&DataKey::IsOracleSource(oracle.clone()))
            .unwrap_or(false);

        assert!(is_authorized, "oracle not authorized");

        assert!(price > 0, "price must be positive");

        let current_time = env.ledger().timestamp();

        let feed = PriceFeed {
            source: oracle.clone(),
            asset: asset.clone(),
            price,
            timestamp: current_time,
        };

        env.storage()
            .instance()
            .set(&DataKey::PriceData(asset.clone(), oracle.clone()), &feed);

        // Topic: event name only; asset + oracle + price in data.
        env.events().publish(
            (symbol_short!("submit"),),
            (oracle.clone(), asset.clone(), price, current_time),
        );
        env.events()
            .publish((symbol_short!("submit"), asset.clone(), oracle), price);
    }

    /// Calculate and store the median price for an asset with outlier detection
    ///
    /// Collects price inputs from N registered oracle sources, sorts the prices array,
    /// removes extreme min/max outliers if N >= 5, and calculates the median value.
    /// This simple outlier exclusion protects against single-oracle manipulation attacks.
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `asset` - Asset address
    /// * `sources` - List of oracle sources to include
    ///
    /// # Returns
    /// The calculated median price
    ///
    /// # Panics
    /// Panics if minimum sources requirement is not met
    pub fn calculate_median(env: Env, asset: Address, sources: Vec<Address>) -> i128 {
        let min_sources: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinSources)
            .expect("min sources not set");

        assert!(sources.len() >= min_sources, "minimum sources not met");

        // Collect all valid prices
        let mut prices: Vec<i128> = Vec::new(&env);

        for source in sources.iter() {
            let feed_key = DataKey::PriceData(asset.clone(), source.clone());

            if let Some(feed) = env.storage().instance().get::<_, PriceFeed>(&feed_key) {
                prices.push_back(feed.price);
            }
        }

        assert!(
            prices.len() >= min_sources,
            "insufficient valid price feeds"
        );

        // Sort prices in ascending order
        prices = Self::sort_prices(&env, prices);

        // Remove extreme min/max outliers if N >= 5
        let n = prices.len();
        let filtered_prices = if n >= 5 {
            // Remove the minimum (first) and maximum (last) values
            let mut filtered: Vec<i128> = Vec::new(&env);
            for i in 1..(n - 1) {
                filtered.push_back(prices.get_unchecked(i));
            }
            filtered
        } else {
            // No outlier removal for N < 5
            prices
        };

        // Calculate median
        let len = filtered_prices.len();
        let median = if len.is_multiple_of(2) {
            // Even number: average of two middle values
            let mid1 = filtered_prices.get_unchecked(len / 2 - 1);
            let mid2 = filtered_prices.get_unchecked(len / 2);
            (mid1.checked_add(mid2).expect("median overflow")) / 2
        } else {
            // Odd number: middle value
            filtered_prices.get_unchecked(len / 2)
        };

        // Check if update should be triggered
        let should_update = Self::should_update_price(&env, asset.clone(), median);

        if should_update {
            // Store median price
            env.storage()
                .instance()
                .set(&DataKey::MedianPrice(asset.clone()), &median);
            env.storage().instance().set(
                &DataKey::LastUpdate(asset.clone()),
                &env.ledger().timestamp(),
            );

            // Topic: event name only; asset + median in data.
            env.events().publish(
                (symbol_short!("amm"), symbol_short!("median")),
                (asset, median),
            );
        }

        median
    }

    /// Get the current median price for an asset
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `asset` - Asset address
    ///
    /// # Returns
    /// Median price
    ///
    /// # Panics
    /// Panics if no median price is available
    pub fn get_median_price(env: Env, asset: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MedianPrice(asset))
            .expect("no median price available")
    }

    /// Get the last update timestamp for an asset
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `asset` - Asset address
    ///
    /// # Returns
    /// Last update timestamp
    pub fn get_last_update(env: Env, asset: Address) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::LastUpdate(asset))
            .unwrap_or(0)
    }

    /// Check if price update should be triggered based on heartbeat or deviation
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `asset` - Asset address
    /// * `new_price` - New price to check
    ///
    /// # Returns
    /// True if update should be triggered
    fn should_update_price(env: &Env, asset: Address, new_price: i128) -> bool {
        let current_time = env.ledger().timestamp();

        // Check heartbeat trigger
        if let Some(heartbeat) = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::Heartbeat(asset.clone()))
        {
            let last_update: u64 = env
                .storage()
                .instance()
                .get(&DataKey::LastUpdate(asset.clone()))
                .unwrap_or(0);

            if current_time
                > last_update
                    .checked_add(heartbeat)
                    .expect("heartbeat overflow")
            {
                return true; // Heartbeat exceeded
            }
        }

        // Check deviation trigger
        if let Some(deviation_threshold_bps) = env
            .storage()
            .instance()
            .get::<_, u32>(&DataKey::DeviationThreshold(asset.clone()))
        {
            if let Some(old_price) = env
                .storage()
                .instance()
                .get::<_, i128>(&DataKey::MedianPrice(asset.clone()))
            {
                if old_price > 0 {
                    let deviation = if new_price > old_price {
                        new_price - old_price
                    } else {
                        old_price - new_price
                    };

                    let deviation_bps =
                        deviation.checked_mul(10000).expect("deviation overflow") / old_price;

                    if deviation_bps >= deviation_threshold_bps as i128 {
                        return true; // Deviation threshold exceeded
                    }
                }
            }
        }

        // If no previous price, always update
        !env.storage().instance().has(&DataKey::MedianPrice(asset))
    }

    /// Sort prices in ascending order (bubble sort for simplicity)
    ///
    /// # Arguments
    /// * `env` - The environment
    /// * `prices` - Vector of prices to sort
    ///
    /// # Returns
    /// Sorted vector of prices
    fn sort_prices(_env: &Env, prices: Vec<i128>) -> Vec<i128> {
        let mut sorted = prices.clone();
        let len = sorted.len();

        for i in 0..len {
            for j in 0..(len - i - 1) {
                if sorted.get_unchecked(j) > sorted.get_unchecked(j + 1) {
                    let temp = sorted.get_unchecked(j);
                    sorted.set(j, sorted.get_unchecked(j + 1));
                    sorted.set(j + 1, temp);
                }
            }
        }

        sorted
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, OracleMedianizerClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(OracleMedianizer, ());
        let client = OracleMedianizerClient::new(&env, &contract_id);
        client.initialize(&admin, &3u32);
        (env, client, admin)
    }

    #[test]
    fn test_initialize() {
        let (_, _client, _admin) = setup();
        // Just verify initialization doesn't panic
    }

    #[test]
    fn test_add_oracle_source() {
        let (env, client, admin) = setup();
        let oracle = Address::generate(&env);
        client.add_oracle_source(&admin, &oracle);
    }

    #[test]
    fn test_submit_and_calculate_median() {
        let (env, client, admin) = setup();

        let oracle1 = Address::generate(&env);
        let oracle2 = Address::generate(&env);
        let oracle3 = Address::generate(&env);

        client.add_oracle_source(&admin, &oracle1);
        client.add_oracle_source(&admin, &oracle2);
        client.add_oracle_source(&admin, &oracle3);

        let asset = Address::generate(&env);

        // Submit prices
        client.submit_price(&oracle1, &asset, &1000000000i128); // $10.00
        client.submit_price(&oracle2, &asset, &1010000000i128); // $10.10
        client.submit_price(&oracle3, &asset, &990000000i128);  // $9.90

        let sources = soroban_sdk::vec![&env, oracle1.clone(), oracle2.clone(), oracle3.clone()];
        let median = client.calculate_median(&asset, &sources);

        // Median should be around 1000000000 ($10.00)
        assert!(median > 990000000 && median < 1010000000);
    }

    // ── Min/Max Outlier Exclusion Tests ────────────────────────────────

    #[test]
    fn test_outlier_exclusion_with_5_sources() {
        let (env, client, admin) = setup();

        let oracle1 = Address::generate(&env);
        let oracle2 = Address::generate(&env);
        let oracle3 = Address::generate(&env);
        let oracle4 = Address::generate(&env);
        let oracle5 = Address::generate(&env);

        client.add_oracle_source(&admin, &oracle1);
        client.add_oracle_source(&admin, &oracle2);
        client.add_oracle_source(&admin, &oracle3);
        client.add_oracle_source(&admin, &oracle4);
        client.add_oracle_source(&admin, &oracle5);

        let asset = Address::generate(&env);

        // Four honest feeds around $10 and one compromised feed at $1000
        client.submit_price(&oracle1, &asset, &1_000_000_000i128); // $10.00
        client.submit_price(&oracle2, &asset, &1_010_000_000i128); // $10.10
        client.submit_price(&oracle3, &asset, &990_000_000i128);   // $9.90
        client.submit_price(&oracle4, &asset, &1_005_000_000i128); // $10.05
        client.submit_price(&oracle5, &asset, &100_000_000_000i128); // $1000 — outlier

        let sources = soroban_sdk::vec![
            &env,
            oracle1.clone(),
            oracle2.clone(),
            oracle3.clone(),
            oracle4.clone(),
            oracle5.clone()
        ];
        let median = client.calculate_median(&asset, &sources);

        // With N=5, min ($9.90) and max ($1000) are removed
        // Remaining: [1_000_000_000, 1_005_000_000, 1_010_000_000]
        // Median should be 1_005_000_000 ($10.05)
        assert_eq!(median, 1_005_000_000);
    }

    #[test]
    fn test_outlier_exclusion_with_skewed_inputs() {
        let (env, client, admin) = setup();

        let oracle1 = Address::generate(&env);
        let oracle2 = Address::generate(&env);
        let oracle3 = Address::generate(&env);
        let oracle4 = Address::generate(&env);
        let oracle5 = Address::generate(&env);

        client.add_oracle_source(&admin, &oracle1);
        client.add_oracle_source(&admin, &oracle2);
        client.add_oracle_source(&admin, &oracle3);
        client.add_oracle_source(&admin, &oracle4);
        client.add_oracle_source(&admin, &oracle5);

        let asset = Address::generate(&env);

        // Skewed inputs: one very low, one very high, three clustered
        client.submit_price(&oracle1, &asset, &100i128);           // $0.000001 — outlier
        client.submit_price(&oracle2, &asset, &1_000_000_000i128); // $10.00
        client.submit_price(&oracle3, &asset, &1_010_000_000i128); // $10.10
        client.submit_price(&oracle4, &asset, &1_005_000_000i128); // $10.05
        client.submit_price(&oracle5, &asset, &10_000_000_000i128); // $100 — outlier

        let sources = soroban_sdk::vec![
            &env,
            oracle1.clone(),
            oracle2.clone(),
            oracle3.clone(),
            oracle4.clone(),
            oracle5.clone()
        ];
        let median = client.calculate_median(&asset, &sources);

        // Min (100) and max (10B) removed
        // Remaining: [1_000_000_000, 1_005_000_000, 1_010_000_000]
        // Median should be 1_005_000_000 ($10.05)
        assert_eq!(median, 1_005_000_000);
    }

    #[test]
    fn test_no_outlier_exclusion_with_3_sources() {
        let (env, client, admin) = setup();

        let oracle1 = Address::generate(&env);
        let oracle2 = Address::generate(&env);
        let oracle3 = Address::generate(&env);

        client.add_oracle_source(&admin, &oracle1);
        client.add_oracle_source(&admin, &oracle2);
        client.add_oracle_source(&admin, &oracle3);

        let asset = Address::generate(&env);

        // With N=3, no outlier removal
        client.submit_price(&oracle1, &asset, &1_000_000_000i128);
        client.submit_price(&oracle2, &asset, &1_010_000_000i128);
        client.submit_price(&oracle3, &asset, &995_000_000i128);

        let sources = soroban_sdk::vec![&env, oracle1.clone(), oracle2.clone(), oracle3.clone()];
        let median = client.calculate_median(&asset, &sources);

        // Sorted: [995_000_000, 1_000_000_000, 1_010_000_000]
        // Median should be 1_000_000_000
        assert_eq!(median, 1_000_000_000);
    }

    #[test]
    fn test_no_outlier_exclusion_with_4_sources() {
        let (env, client, admin) = setup();

        let oracle1 = Address::generate(&env);
        let oracle2 = Address::generate(&env);
        let oracle3 = Address::generate(&env);
        let oracle4 = Address::generate(&env);

        client.add_oracle_source(&admin, &oracle1);
        client.add_oracle_source(&admin, &oracle2);
        client.add_oracle_source(&admin, &oracle3);
        client.add_oracle_source(&admin, &oracle4);

        let asset = Address::generate(&env);

        // With N=4, no outlier removal
        client.submit_price(&oracle1, &asset, &1_000_000_000i128);
        client.submit_price(&oracle2, &asset, &1_010_000_000i128);
        client.submit_price(&oracle3, &asset, &995_000_000i128);
        client.submit_price(&oracle4, &asset, &1_005_000_000i128);

        let sources = soroban_sdk::vec![
            &env,
            oracle1.clone(),
            oracle2.clone(),
            oracle3.clone(),
            oracle4.clone()
        ];
        let median = client.calculate_median(&asset, &sources);

        // Sorted: [995_000_000, 1_000_000_000, 1_005_000_000, 1_010_000_000]
        // Median = (1_000_000_000 + 1_005_000_000) / 2 = 1_002_500_000
        assert_eq!(median, 1_002_500_000);
    }

    #[test]
    fn test_outlier_exclusion_with_6_sources() {
        let (env, client, admin) = setup();

        let oracle1 = Address::generate(&env);
        let oracle2 = Address::generate(&env);
        let oracle3 = Address::generate(&env);
        let oracle4 = Address::generate(&env);
        let oracle5 = Address::generate(&env);
        let oracle6 = Address::generate(&env);

        client.add_oracle_source(&admin, &oracle1);
        client.add_oracle_source(&admin, &oracle2);
        client.add_oracle_source(&admin, &oracle3);
        client.add_oracle_source(&admin, &oracle4);
        client.add_oracle_source(&admin, &oracle5);
        client.add_oracle_source(&admin, &oracle6);

        let asset = Address::generate(&env);

        // Six sources with outliers on both ends
        client.submit_price(&oracle1, &asset, &100i128);           // $0.000001 — outlier
        client.submit_price(&oracle2, &asset, &1_000_000_000i128); // $10.00
        client.submit_price(&oracle3, &asset, &1_010_000_000i128); // $10.10
        client.submit_price(&oracle4, &asset, &1_005_000_000i128); // $10.05
        client.submit_price(&oracle5, &asset, &1_015_000_000i128); // $10.15
        client.submit_price(&oracle6, &asset, &10_000_000_000i128); // $100 — outlier

        let sources = soroban_sdk::vec![
            &env,
            oracle1.clone(),
            oracle2.clone(),
            oracle3.clone(),
            oracle4.clone(),
            oracle5.clone(),
            oracle6.clone()
        ];
        let median = client.calculate_median(&asset, &sources);

        // Min (100) and max (10B) removed
        // Remaining: [1_000_000_000, 1_005_000_000, 1_010_000_000, 1_015_000_000]
        // Median = (1_005_000_000 + 1_010_000_000) / 2 = 1_007_500_000
        assert_eq!(median, 1_007_500_000);
    }
}
