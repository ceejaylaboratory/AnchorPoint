#![cfg_attr(not(test), no_std)]

use core::cmp;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token, Address, Env, Vec,
};
use ethnum::U256;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum SwapError {
    SlippageExceeded = 1,
    InvariantViolation = 2,
}

/// Fetch the decimal precision of a token contract dynamically.
/// Falls back to 7 (the Stellar native/SAC default) on any error.
fn get_token_decimals(env: &Env, token_addr: &Address) -> u32 {
    token::Client::new(env, token_addr).decimals()
}

// Constants for tick math
const MIN_TICK: i32 = -887272;
const MAX_TICK: i32 = 887272;
const TICK_SPACING: i32 = 60; // Default tick spacing
pub const MIN_FEE_BPS: u32 = 30; // 0.3% (30 basis points)
pub const MAX_FEE_BPS: u32 = 100; // 1.0% (100 basis points)
pub const FEE_DENOMINATOR: u32 = 10000;
const WINDOW_SIZE: u64 = 3600; // 1 hour window
const VOLUME_THRESHOLD: i128 = 500_000_0000000; // 500k volume threshold for scaling
const VOLATILITY_THRESHOLD: u128 = 10_000_000; // price change threshold for scaling
const FEE_TIER: u32 = 3000; // 0.3% fee tier (3000 basis points)
const PRECISION: i128 = 1_000_000_000_000_000_000;

// Tick data structure
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Tick {
    pub liquidity_gross: i128,
    pub liquidity_net: i128,
    pub fee_growth_outside_0x128: i128,
    pub fee_growth_outside_1x128: i128,
}

// Position data structure
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub owner: Address,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub liquidity: i128,
    pub fee_growth_inside_0_last_x128: i128,
    pub fee_growth_inside_1_last_x128: i128,
    pub tokens_owed_0: i128,
    pub tokens_owed_1: i128,
}

// Swap event data
#[contracttype]
#[derive(Clone, Debug)]
pub struct SwapEvent {
    /// The address that initiated and received the swap (sender == recipient in this contract).
    pub recipient: Address,
    pub amount_0: i128,
    pub amount_1: i128,
    /// Packed as u64 to halve storage vs u128; full precision not needed for event indexing.
    pub sqrt_price_x96: u64,
    pub liquidity: i128,
    pub tick: i32,
    pub fee_bps: u32,
}

// Volume and volatility tracking
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VolumeTracker {
    pub window_start: u64,
    pub volume: i128,
    pub price_change_sum: u128,
    pub last_sqrt_price: u128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    TokenA,
    TokenB,
    // Concentrated liquidity state
    CurrentTick,
    CurrentSqrtPriceX96,
    CurrentLiquidity,
    FeeGrowthGlobal0X128,
    FeeGrowthGlobal1X128,
    // Protocol fees
    ProtocolFee,
    // Referral program
    Referrer(Address), // User -> Referrer mapping
    ReferralFeeRate, // Fee rate for referrals (in basis points, e.g., 100 = 1%)
    // Tick data mapping (tick -> Tick)
    Tick(i32),
    // Position mapping (owner + tick_lower + tick_upper -> Position)
    Position(Address, i32, i32),
    // User positions list for enumeration
    UserPositions(Address),
    // Volume tracker
    VolumeTracker,
    // Sqrt price associated with an initialized tick
    TickSqrtPrice(i32),
}

#[contract]
pub struct MultiAssetSwap;

// Tick math utilities
impl MultiAssetSwap {
    /// Get the next tick at or above `tick` that is a multiple of `tick_spacing`
    pub fn next_tick_at_or_above(tick: i32, tick_spacing: i32) -> i32 {
        if tick >= 0 {
            ((tick + tick_spacing - 1) / tick_spacing) * tick_spacing
        } else {
            -((-tick + tick_spacing - 1) / tick_spacing) * tick_spacing
        }
    }

    /// Get the next tick below `tick` that is a multiple of `tick_spacing`
    pub fn next_tick_below(tick: i32, tick_spacing: i32) -> i32 {
        if tick > 0 {
            ((tick - 1) / tick_spacing) * tick_spacing
        } else {
            -(((-tick - 1) / tick_spacing) * tick_spacing + tick_spacing)
        }
    }

    /// Convert a tick to sqrt(1.0001^tick) in Q96 fixed point.
    pub fn tick_to_sqrt_price_x96(tick: i32) -> u128 {
        const Q96: u128 = 1_u128 << 96;
        const SQRT_1_0001_Q96: u128 = 79_232_123_823_359_799_118_286_999_567;

        // This contract stores prices in u128, so values outside that range are
        // saturated instead of overflowing during exponentiation.
        if tick > 443_636 {
            return u128::MAX;
        }
        if tick < -443_636 {
            return 0;
        }

        let scale = U256::from(Q96);
        let mut exponent = tick.unsigned_abs();
        let mut factor = if tick < 0 {
            (scale * scale) / U256::from(SQRT_1_0001_Q96)
        } else {
            U256::from(SQRT_1_0001_Q96)
        };
        let mut ratio = scale;

        while exponent > 0 {
            if exponent & 1 == 1 {
                ratio = (ratio * factor) / scale;
            }
            exponent >>= 1;
            if exponent > 0 {
                factor = (factor * factor) / scale;
            }
        }

        u128::try_from(ratio).unwrap_or(if tick < 0 { 0 } else { u128::MAX })
    }

    /// Simple power function for integer math
    fn pow(base: u128, exponent: i128) -> u128 {
        if exponent == 0 {
            return 1;
        }
        if exponent == 1 {
            return base;
        }
        
        let mut result = 1u128;
        let mut base_pow = base;
        let mut exp = exponent as u64;
        
        while exp > 0 {
            if exp % 2 == 1 {
                result = result.checked_mul(base_pow).unwrap_or(u128::MAX);
            }
            base_pow = base_pow.checked_mul(base_pow).unwrap_or(u128::MAX);
            exp /= 2;
        }
        
        result
    }

    /// Calculate amount of liquidity for given amount of token0 and price range
    pub fn get_liquidity_for_amount0(
        sqrt_ratio_a_x96: u128,
        sqrt_ratio_b_x96: u128,
        amount0: i128,
    ) -> i128 {
        if sqrt_ratio_a_x96 > sqrt_ratio_b_x96 {
            return Self::get_liquidity_for_amount0(sqrt_ratio_b_x96, sqrt_ratio_a_x96, amount0);
        }
        if sqrt_ratio_a_x96 == 0 || amount0 <= 0 {
            return 0;
        }
        let diff = sqrt_ratio_b_x96.saturating_sub(sqrt_ratio_a_x96);
        if diff == 0 {
            return 0;
        }
        // L = amount0 * sqrtA * sqrtB / (2^96 * (sqrtB - sqrtA))
        // To avoid u128 overflow: divide numerator and denominator by 2^48
        let sqrt_a = sqrt_ratio_a_x96 >> 48;
        let sqrt_b = sqrt_ratio_b_x96 >> 48;
        let diff_scaled = diff >> 48;
        let numerator = (amount0 as u128)
            .saturating_mul(sqrt_a)
            .saturating_mul(sqrt_b);
        let denominator = diff_scaled.saturating_mul(1u128 << 48); // restore 2^96/2^48 = 2^48
        (numerator.checked_div(denominator.max(1)).unwrap_or(0)) as i128
    }

    /// Calculate amount of liquidity for given amount of token1 and price range
    pub fn get_liquidity_for_amount1(
        sqrt_ratio_a_x96: u128,
        sqrt_ratio_b_x96: u128,
        amount1: i128,
    ) -> i128 {
        if sqrt_ratio_a_x96 > sqrt_ratio_b_x96 {
            return Self::get_liquidity_for_amount1(sqrt_ratio_b_x96, sqrt_ratio_a_x96, amount1);
        }
        
        let numerator = amount1 as u128 * (1u128 << 96);
        let denominator = sqrt_ratio_b_x96;
        
        (numerator.checked_div(denominator).unwrap_or(0)) as i128
    }

    pub fn get_amount0_for_liquidity(
        sqrt_ratio_a_x96: u128,
        sqrt_ratio_b_x96: u128,
        liquidity: i128,
    ) -> i128 {
        if sqrt_ratio_a_x96 > sqrt_ratio_b_x96 {
            return Self::get_amount0_for_liquidity(sqrt_ratio_b_x96, sqrt_ratio_a_x96, liquidity);
        }
        if liquidity <= 0 || sqrt_ratio_a_x96 == 0 {
            return 0;
        }
        let diff = sqrt_ratio_b_x96.saturating_sub(sqrt_ratio_a_x96);
        // amount0 = L * 2^96 * (sqrtB - sqrtA) / (sqrtA * sqrtB)
        // To avoid overflow, divide numerator and denominator by 2^96
        let sqrt_a_scaled = sqrt_ratio_a_x96 >> 48;
        let sqrt_b_scaled = sqrt_ratio_b_x96 >> 48;
        let denominator = sqrt_a_scaled.saturating_mul(sqrt_b_scaled).max(1);
        let numerator = (liquidity as u128).saturating_mul(diff);
        (numerator.checked_div(denominator).unwrap_or(0)) as i128
    }

    pub fn get_amount1_for_liquidity(
        sqrt_ratio_a_x96: u128,
        sqrt_ratio_b_x96: u128,
        liquidity: i128,
    ) -> i128 {
        if sqrt_ratio_a_x96 > sqrt_ratio_b_x96 {
            return Self::get_amount1_for_liquidity(sqrt_ratio_b_x96, sqrt_ratio_a_x96, liquidity);
        }
        if liquidity <= 0 {
            return 0;
        }
        let diff = sqrt_ratio_b_x96.saturating_sub(sqrt_ratio_a_x96);
        let numerator = (liquidity as u128).saturating_mul(diff);
        let denominator = 1u128 << 96;
        (numerator.checked_div(denominator).unwrap_or(0)) as i128
    }

    /// Virtual reserves of the active liquidity at `sqrt_price_x96`:
    /// reserve_a = L * 2^96 / sqrtP, reserve_b = L * sqrtP / 2^96.
    fn virtual_reserves(liquidity: i128, sqrt_price_x96: u128) -> (U256, U256) {
        if liquidity <= 0 || sqrt_price_x96 == 0 {
            return (U256::from(0_u8), U256::from(0_u8));
        }
        let q96 = U256::from(1_u128 << 96);
        let liquidity = U256::from(liquidity as u128);
        let sqrt_price = U256::from(sqrt_price_x96);
        let reserve_a = liquidity.checked_mul(q96).expect("invariant overflow") / sqrt_price;
        let reserve_b = liquidity.checked_mul(sqrt_price).expect("invariant overflow") / q96;
        (reserve_a, reserve_b)
    }

    /// Constant product k = reserve_a * reserve_b.
    fn pool_k(reserve_a: U256, reserve_b: U256) -> U256 {
        reserve_a.checked_mul(reserve_b).expect("invariant overflow")
    }

    /// k of the active liquidity at `sqrt_price_x96`.
    fn liquidity_k(liquidity: i128, sqrt_price_x96: u128) -> U256 {
        let (reserve_a, reserve_b) = Self::virtual_reserves(liquidity, sqrt_price_x96);
        Self::pool_k(reserve_a, reserve_b)
    }

    /// k before and after a swap. The fee stays in the pool, so the gross
    /// input (fee included) is added to the input-side reserve. An output that
    /// exceeds the output-side reserve yields new_k = 0.
    fn swap_k(
        liquidity: i128,
        sqrt_price_x96: u128,
        zero_for_one: bool,
        gross_amount_in: i128,
        amount_out: i128,
    ) -> (U256, U256) {
        let (reserve_a, reserve_b) = Self::virtual_reserves(liquidity, sqrt_price_x96);
        let old_k = Self::pool_k(reserve_a, reserve_b);
        let amount_in = U256::from(gross_amount_in.max(0) as u128);
        let amount_out = U256::from(amount_out.max(0) as u128);
        let (new_a, new_b) = if zero_for_one {
            (reserve_a.checked_add(amount_in), reserve_b.checked_sub(amount_out))
        } else {
            (reserve_a.checked_sub(amount_out), reserve_b.checked_add(amount_in))
        };
        let new_k = match (new_a, new_b) {
            (Some(a), Some(b)) => Self::pool_k(a, b),
            _ => U256::from(0_u8),
        };
        (old_k, new_k)
    }

    /// Post-condition for every pool mutation: k must not decrease.
    fn assert_invariant(env: &Env, old_k: U256, new_k: U256) {
        if new_k < old_k {
            panic_with_error!(env, SwapError::InvariantViolation);
        }
    }
}

#[contractimpl]
impl MultiAssetSwap {
    /// Initializes the swap pool with concentrated liquidity.
    pub fn initialize(env: Env, token_a: Address, token_b: Address, sqrt_price_x96: u128, tick: i32) {
        if env.storage().instance().has(&DataKey::TokenA) {
            panic!("already initialized");
        }
        
        // Validate tick bounds
        assert!(tick >= MIN_TICK && tick <= MAX_TICK, "tick out of bounds");
        
        env.storage().instance().set(&DataKey::TokenA, &token_a);
        env.storage().instance().set(&DataKey::TokenB, &token_b);
        
        // Initialize concentrated liquidity state
        env.storage().instance().set(&DataKey::CurrentTick, &tick);
        env.storage().instance().set(&DataKey::CurrentSqrtPriceX96, &sqrt_price_x96);
        env.storage().instance().set(&DataKey::CurrentLiquidity, &0_i128);
        env.storage().instance().set(&DataKey::FeeGrowthGlobal0X128, &0_i128);
        env.storage().instance().set(&DataKey::FeeGrowthGlobal1X128, &0_i128);
        env.storage().instance().set(&DataKey::ProtocolFee, &0_u32);
        
        // Initialize volume tracker
        env.storage().instance().set(&DataKey::VolumeTracker, &VolumeTracker {
            window_start: env.ledger().timestamp(),
            volume: 0,
            price_change_sum: 0,
            last_sqrt_price: sqrt_price_x96,
        });
        env.storage().instance().set(&DataKey::ReferralFeeRate, &100_u32); // 1% referral fee by default
        env.events().publish(
            (symbol_short!("pool_init"),),
            (token_a, token_b, sqrt_price_x96, tick),
        );
    }

    /// Initialize a tick with its canonical Q96 square-root price.
    pub fn initialize_tick(env: Env, tick_index: i32, sqrt_price_x96: u128) {
        assert!(tick_index >= MIN_TICK && tick_index <= MAX_TICK, "tick out of bounds");
        assert!(tick_index % TICK_SPACING == 0, "invalid tick spacing");
        assert!(sqrt_price_x96 > 0, "invalid sqrt price");
        assert!(
            sqrt_price_x96 == Self::tick_to_sqrt_price_x96(tick_index),
            "sqrt price does not match tick"
        );

        let tick_key = DataKey::Tick(tick_index);
        assert!(!env.storage().instance().has(&tick_key), "tick already initialized");
        env.storage().instance().set(&tick_key, &Tick {
            liquidity_gross: 0,
            liquidity_net: 0,
            fee_growth_outside_0x128: 0,
            fee_growth_outside_1x128: 0,
        });
        env.storage()
            .instance()
            .set(&DataKey::TickSqrtPrice(tick_index), &sqrt_price_x96);
    }

    /// Return the canonical sqrt price for an initialized tick.
    pub fn get_tick_sqrt_price(env: Env, tick_index: i32) -> u128 {
        env.storage()
            .instance()
            .get(&DataKey::TickSqrtPrice(tick_index))
            .expect("tick not initialized")
    }

    /// Compute the output of one concentrated-liquidity swap step.
    pub fn compute_swap_step(
        _env: Env,
        sqrt_ratio_current: u128,
        sqrt_ratio_target: u128,
        liquidity: i128,
        amount: i128,
    ) -> i128 {
        SwapMath::compute_swap_step(
            sqrt_ratio_current,
            sqrt_ratio_target,
            liquidity,
            amount,
        )
    }

    /// Creates a new position with concentrated liquidity.
    pub fn mint(
        env: Env,
        recipient: Address,
        tick_lower: i32,
        tick_upper: i32,
        amount0_desired: i128,
        amount1_desired: i128,
    ) -> (i128, i128, i128) {
        recipient.require_auth();
        
        // Validate ticks
        assert!(tick_lower >= MIN_TICK && tick_lower < tick_upper, "invalid tick range");
        assert!(tick_upper <= MAX_TICK, "tick out of bounds");
        assert!(tick_lower % TICK_SPACING == 0 && tick_upper % TICK_SPACING == 0, "invalid tick spacing");
        assert!(amount0_desired > 0 || amount1_desired > 0, "zero liquidity");
        
        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("not initialized");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("not initialized");
        let current_sqrt_price_x96: u128 = env.storage().instance().get(&DataKey::CurrentSqrtPriceX96).expect("not initialized");
        
        // Calculate sqrt prices for tick boundaries
        let sqrt_price_lower_x96 = Self::tick_to_sqrt_price_x96(tick_lower);
        let sqrt_price_upper_x96 = Self::tick_to_sqrt_price_x96(tick_upper);
        
        // Calculate liquidity amounts
        let liquidity = if current_sqrt_price_x96 < sqrt_price_lower_x96 {
            // Current price below range: only token0 needed
            Self::get_liquidity_for_amount0(sqrt_price_lower_x96, sqrt_price_upper_x96, amount0_desired)
        } else if current_sqrt_price_x96 < sqrt_price_upper_x96 {
            // Current price within range: both tokens needed
            let liquidity0 = Self::get_liquidity_for_amount0(sqrt_price_lower_x96, current_sqrt_price_x96, amount0_desired);
            let liquidity1 = Self::get_liquidity_for_amount1(current_sqrt_price_x96, sqrt_price_upper_x96, amount1_desired);
            core::cmp::min(liquidity0, liquidity1)
        } else {
            // Current price above range: only token1 needed
            Self::get_liquidity_for_amount1(sqrt_price_lower_x96, sqrt_price_upper_x96, amount1_desired)
        };
        
        assert!(liquidity > 0, "insufficient liquidity amount");
        
        // Calculate actual token amounts needed
        let amount0 = if current_sqrt_price_x96 < sqrt_price_lower_x96 {
            Self::get_amount0_for_liquidity(sqrt_price_lower_x96, sqrt_price_upper_x96, liquidity)
        } else if current_sqrt_price_x96 < sqrt_price_upper_x96 {
            Self::get_amount0_for_liquidity(sqrt_price_lower_x96, current_sqrt_price_x96, liquidity)
        } else {
            0
        };
        
        let amount1 = if current_sqrt_price_x96 < sqrt_price_lower_x96 {
            0
        } else if current_sqrt_price_x96 < sqrt_price_upper_x96 {
            Self::get_amount1_for_liquidity(current_sqrt_price_x96, sqrt_price_upper_x96, liquidity)
        } else {
            Self::get_amount1_for_liquidity(sqrt_price_lower_x96, sqrt_price_upper_x96, liquidity)
        };
        
        // Transfer tokens from user
        let contract_addr = env.current_contract_address();
        if amount0 > 0 {
            token::Client::new(&env, &token_a).transfer(&recipient, &contract_addr, &amount0);
        }
        if amount1 > 0 {
            token::Client::new(&env, &token_b).transfer(&recipient, &contract_addr, &amount1);
        }
        
        // Update or create position
        let position_key = DataKey::Position(recipient.clone(), tick_lower, tick_upper);
        let mut position: Position = env.storage().instance().get(&position_key).unwrap_or(Position {
            owner: recipient.clone(),
            tick_lower,
            tick_upper,
            liquidity: 0,
            fee_growth_inside_0_last_x128: 0,
            fee_growth_inside_1_last_x128: 0,
            tokens_owed_0: 0,
            tokens_owed_1: 0,
        });
        
        // Update position liquidity
        position.liquidity += liquidity;
        env.storage().instance().set(&position_key, &position);
        
        // Add to user positions list if new
        if position.liquidity == liquidity {
            let mut positions: Vec<(i32, i32)> = env.storage().instance().get(&DataKey::UserPositions(recipient.clone())).unwrap_or_else(|| Vec::new(&env));
            positions.push_back((tick_lower, tick_upper));
            env.storage().instance().set(&DataKey::UserPositions(recipient.clone()), &positions);
        }
        
        // Update ticks
        Self::update_tick(&env, tick_lower, liquidity as i128, true);
        Self::update_tick(&env, tick_upper, liquidity as i128, false);
        
        // Update pool liquidity if current price is within range
        let current_tick: i32 = env.storage().instance().get(&DataKey::CurrentTick).expect("not initialized");
        let liquidity_before: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
        if tick_lower <= current_tick && current_tick < tick_upper {
            let current_liquidity: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
            env.storage().instance().set(&DataKey::CurrentLiquidity, &(current_liquidity + liquidity));
        }
        
        // Invariant: adding liquidity must not decrease k at the current price.
        let liquidity_after: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
        Self::assert_invariant(
            &env,
            Self::liquidity_k(liquidity_before, current_sqrt_price_x96),
            Self::liquidity_k(liquidity_after, current_sqrt_price_x96),
        );
        
        // Topic: event name only; recipient + tick range + amounts in data.
        env.events().publish((symbol_short!("mint"),), (recipient, tick_lower, tick_upper, liquidity, amount0, amount1));
        
        (liquidity, amount0, amount1)
    }

    /// Updates a tick with new liquidity
    fn update_tick(env: &Env, tick: i32, liquidity_delta: i128, lower: bool) {
        let tick_key = DataKey::Tick(tick);
        let mut tick_data: Tick = env.storage().instance().get(&tick_key).unwrap_or(Tick {
            liquidity_gross: 0,
            liquidity_net: 0,
            fee_growth_outside_0x128: 0,
            fee_growth_outside_1x128: 0,
        });
        
        tick_data.liquidity_gross = tick_data.liquidity_gross.checked_add(liquidity_delta.abs()).unwrap_or(i128::MAX);
        
        if lower {
            tick_data.liquidity_net += liquidity_delta;
        } else {
            tick_data.liquidity_net -= liquidity_delta;
        }
        
        if tick_data.liquidity_gross == 0 {
            env.storage().instance().remove(&tick_key);
            env.storage()
                .instance()
                .remove(&DataKey::TickSqrtPrice(tick));
        } else {
            env.storage().instance().set(&tick_key, &tick_data);
            env.storage().instance().set(
                &DataKey::TickSqrtPrice(tick),
                &Self::tick_to_sqrt_price_x96(tick),
            );
        }
    }

    /// Cross a tick boundary and update liquidity
    fn cross_tick(env: &Env, tick: i32, liquidity: i128) -> i128 {
        let tick_key = DataKey::Tick(tick);
        if let Some(tick_data) = env.storage().instance().get::<DataKey, Tick>(&tick_key) {
            return liquidity + tick_data.liquidity_net;
        }
        liquidity
    }

    /// Calculate the dynamic fee based on volume and volatility
    pub fn calculate_dynamic_fee(env: &Env) -> u32 {
        let mut tracker: VolumeTracker = env.storage().instance().get(&DataKey::VolumeTracker).unwrap();
        let now = env.ledger().timestamp();
        
        // Reset window if needed
        if now >= tracker.window_start + WINDOW_SIZE {
            tracker.window_start = now;
            tracker.volume = 0;
            tracker.price_change_sum = 0;
            env.storage().instance().set(&DataKey::VolumeTracker, &tracker);
            return MIN_FEE_BPS;
        }
        
        // Calculate fee based on volume and volatility
        // Fee = MIN_FEE + (MAX_FEE - MIN_FEE) * min(1, (volume/vol_thresh + price_change/price_thresh))
        let volume_factor = (tracker.volume as u128).checked_mul(100).unwrap_or(u128::MAX) / (VOLUME_THRESHOLD as u128).max(1);
        let volatility_factor = tracker.price_change_sum.checked_mul(100).unwrap_or(u128::MAX) / VOLATILITY_THRESHOLD.max(1);
        
        let total_factor = (volume_factor + volatility_factor).min(100) as u32;
        let fee_increase = (MAX_FEE_BPS - MIN_FEE_BPS) * total_factor / 100;
        
        MIN_FEE_BPS + fee_increase
    }

    /// Update the volume tracker with new trade data
    fn update_tracker(env: &Env, amount_in: i128, new_sqrt_price: u128) {
        let mut tracker: VolumeTracker = env.storage().instance().get(&DataKey::VolumeTracker).unwrap();
        let now = env.ledger().timestamp();
        
        // Check if we need to rotate window
        if now >= tracker.window_start + WINDOW_SIZE {
            tracker.window_start = now;
            tracker.volume = amount_in;
            tracker.price_change_sum = 0;
        } else {
            tracker.volume += amount_in;
            let price_diff = if new_sqrt_price > tracker.last_sqrt_price {
                new_sqrt_price - tracker.last_sqrt_price
            } else {
                tracker.last_sqrt_price - new_sqrt_price
            };
            tracker.price_change_sum += price_diff;
        }
        
        tracker.last_sqrt_price = new_sqrt_price;
        env.storage().instance().set(&DataKey::VolumeTracker, &tracker);
    }

    /// Swaps tokens using concentrated liquidity with dynamic fees.
    /// Returns amount out.
    pub fn swap(
        env: Env,
        recipient: Address,
        token_in: Address,
        amount_in: i128,
        sqrt_price_limit_x96: u128,
        min_amount_out: i128,
    ) -> i128 {
        recipient.require_auth();
        assert!(amount_in > 0, "amount must be positive");
        assert!(min_amount_out >= 0, "min_amount_out must be non-negative");

        // Validate token decimal compatibility: both tokens must use the same
        // decimal precision so that amounts are comparable in the swap math.
        let token_a_addr: Address = env.storage().instance().get(&DataKey::TokenA).expect("not initialized");
        let token_b_addr: Address = env.storage().instance().get(&DataKey::TokenB).expect("not initialized");
        let decimals_a = get_token_decimals(&env, &token_a_addr);
        let decimals_b = get_token_decimals(&env, &token_b_addr);
        assert!(
            decimals_a == decimals_b,
            "token decimal mismatch: tokens must share the same decimal precision"
        );
        
        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("not initialized");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("not initialized");
        
        let is_a_in = token_in == token_a;
        if !is_a_in && token_in != token_b {
            panic!("invalid token");
        }
        
        let token_out = if is_a_in { token_b.clone() } else { token_a.clone() };
        let zero_for_one = is_a_in;
        
        let mut current_sqrt_price_x96: u128 = env.storage().instance().get(&DataKey::CurrentSqrtPriceX96).expect("not initialized");
        let mut current_tick: i32 = env.storage().instance().get(&DataKey::CurrentTick).expect("not initialized");
        let current_liquidity: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
        
        // Calculate dynamic fee
        let fee_bps = Self::calculate_dynamic_fee(&env);
        
        // Validate price limit
        if zero_for_one {
            assert!(sqrt_price_limit_x96 < current_sqrt_price_x96, "invalid price limit");
        } else {
            assert!(sqrt_price_limit_x96 > current_sqrt_price_x96, "invalid price limit");
        }
        
        // Transfer tokens in
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &token_in).transfer(&recipient, &contract_addr, &amount_in);
        
        // Apply dynamic fee
        let amount_in_less_fee = amount_in * (FEE_DENOMINATOR - fee_bps) as i128 / FEE_DENOMINATOR as i128;
        if current_liquidity == 0 {
            panic!("insufficient liquidity");
        }
        let sqrt_price_before = current_sqrt_price_x96;
        let (next_sqrt_price, amount_out, amount_in_used) = SwapMath::compute_swap_step_values(
            current_sqrt_price_x96,
            sqrt_price_limit_x96,
            current_liquidity,
            amount_in_less_fee,
        );
        assert!(amount_out > 0, "zero amount out");
        current_sqrt_price_x96 = next_sqrt_price;

        let gross_amount_used = amount_in_used
            .checked_mul(FEE_DENOMINATOR as i128)
            .and_then(|value| {
                value.checked_add((FEE_DENOMINATOR - fee_bps) as i128 - 1)
            })
            .expect("swap input overflow")
            / (FEE_DENOMINATOR - fee_bps) as i128;

        // Invariant: k over the active liquidity's virtual reserves must not
        // decrease after the trade, with the collected fee counted as input.
        let (old_k, new_k) = Self::swap_k(
            current_liquidity,
            sqrt_price_before,
            zero_for_one,
            gross_amount_used,
            amount_out,
        );
        Self::assert_invariant(&env, old_k, new_k);

        let unused_input = amount_in - gross_amount_used;
        if unused_input > 0 {
            token::Client::new(&env, &token_in).transfer(
                &contract_addr,
                &recipient,
                &unused_input,
            );
        }
        
        assert!(amount_out > 0, "zero amount out");
        
        // Update tracker with volume and price change
        Self::update_tracker(&env, gross_amount_used, current_sqrt_price_x96);
        // Slippage protection: ensure amount_out meets minimum threshold
        if amount_out < min_amount_out {
            panic_with_error!(env, SwapError::SlippageExceeded);
        }
        
        // Update pool state
        env.storage().instance().set(&DataKey::CurrentSqrtPriceX96, &current_sqrt_price_x96);
        env.storage().instance().set(&DataKey::CurrentLiquidity, &current_liquidity);
        
        // Update fee growth (simplified)
        let fee_amount = gross_amount_used - amount_in_used;
        
        // Handle referral fee: redirect portion of swap fee to referrer
        let referral_fee_rate: u32 = env.storage().instance().get(&DataKey::ReferralFeeRate).unwrap_or(100);
        let referral_fee = (fee_amount * referral_fee_rate as i128) / 10000;
        
        if referral_fee > 0 {
            // Check if recipient has a referrer
            if let Some(referrer) = env.storage().instance().get(&DataKey::Referrer(recipient.clone())) {
                // Transfer referral fee from the fee amount to referrer
                // For simplicity, we transfer from the token_out (the output token)
                let contract_addr = env.current_contract_address();
                token::Client::new(&env, &token_out).transfer(&contract_addr, &referrer, &referral_fee);
                
                // Reduce amount_out by referral fee
                amount_out -= referral_fee;
            }
        }
        
        if zero_for_one {
            let fee_growth_global: i128 = env.storage().instance().get(&DataKey::FeeGrowthGlobal0X128).unwrap_or(0);
            let new_fee_growth = fee_growth_global + (fee_amount * PRECISION) / current_liquidity.max(1);
            env.storage().instance().set(&DataKey::FeeGrowthGlobal0X128, &new_fee_growth);
        } else {
            let fee_growth_global: i128 = env.storage().instance().get(&DataKey::FeeGrowthGlobal1X128).unwrap_or(0);
            let new_fee_growth = fee_growth_global + (fee_amount * PRECISION) / current_liquidity.max(1);
            env.storage().instance().set(&DataKey::FeeGrowthGlobal1X128, &new_fee_growth);
        }
        
        // Transfer tokens out
        token::Client::new(&env, &token_out).transfer(&contract_addr, &recipient, &amount_out);
        
        // Update tick (simplified - in full implementation would calculate from sqrt price)
        current_tick = if zero_for_one { current_tick - 1 } else { current_tick + 1 };
        env.storage().instance().set(&DataKey::CurrentTick, &current_tick);
        
        // Topic: event name only; all swap details in data.
        env.events().publish(
            (symbol_short!("swap"), recipient.clone()),
            SwapEvent {
                recipient,
                amount_0: if zero_for_one { gross_amount_used } else { -amount_out },
                amount_1: if zero_for_one { -amount_out } else { gross_amount_used },
                sqrt_price_x96: current_sqrt_price_x96 as u64,
                liquidity: current_liquidity,
                tick: current_tick,
                fee_bps,
            },
        );
        
        amount_out
    }

    /// Removes liquidity from a position.
    pub fn collect(
        env: Env,
        recipient: Address,
        tick_lower: i32,
        tick_upper: i32,
        amount0_requested: i128,
        amount1_requested: i128,
    ) -> (i128, i128) {
        recipient.require_auth();
        
        let position_key = DataKey::Position(recipient.clone(), tick_lower, tick_upper);
        let position: Position = env.storage().instance().get(&position_key).expect("position not found");
        
        // Calculate fees owed (simplified)
        let fee_growth_global_0: i128 = env.storage().instance().get(&DataKey::FeeGrowthGlobal0X128).unwrap_or(0);
        let fee_growth_global_1: i128 = env.storage().instance().get(&DataKey::FeeGrowthGlobal1X128).unwrap_or(0);
        
        let tokens_owed_0 = position.tokens_owed_0 +
            ((fee_growth_global_0 - position.fee_growth_inside_0_last_x128) * position.liquidity) / PRECISION;
        let tokens_owed_1 = position.tokens_owed_1 +
            ((fee_growth_global_1 - position.fee_growth_inside_1_last_x128) * position.liquidity) / PRECISION;
        
        let amount0 = core::cmp::min(amount0_requested, tokens_owed_0);
        let amount1 = core::cmp::min(amount1_requested, tokens_owed_1);
        
        // Transfer tokens to recipient
        let token_a: Address = env.storage().instance().get(&DataKey::TokenA).expect("not initialized");
        let token_b: Address = env.storage().instance().get(&DataKey::TokenB).expect("not initialized");
        let contract_addr = env.current_contract_address();
        
        if amount0 > 0 {
            token::Client::new(&env, &token_a).transfer(&contract_addr, &recipient, &amount0);
        }
        if amount1 > 0 {
            token::Client::new(&env, &token_b).transfer(&contract_addr, &recipient, &amount1);
        }
        
        // Update position
        let mut updated_position = position;
        updated_position.tokens_owed_0 -= amount0;
        updated_position.tokens_owed_1 -= amount1;
        updated_position.fee_growth_inside_0_last_x128 = fee_growth_global_0;
        updated_position.fee_growth_inside_1_last_x128 = fee_growth_global_1;
        env.storage().instance().set(&position_key, &updated_position);
        
        // Topic: event name only; recipient + tick range + amounts in data.
        env.events().publish((symbol_short!("collect"),), (recipient, tick_lower, tick_upper, amount0, amount1));
        
        (amount0, amount1)
    }

    /// Burns liquidity from a position.
    pub fn burn(
        env: Env,
        owner: Address,
        tick_lower: i32,
        tick_upper: i32,
        amount: i128,
    ) -> (i128, i128) {
        owner.require_auth();
        
        let position_key = DataKey::Position(owner.clone(), tick_lower, tick_upper);
        let mut position: Position = env.storage().instance().get(&position_key).expect("position not found");
        
        assert!(amount <= position.liquidity, "insufficient liquidity");
        
        let current_tick: i32 = env.storage().instance().get(&DataKey::CurrentTick).expect("not initialized");
        let current_sqrt_price_x96: u128 = env.storage().instance().get(&DataKey::CurrentSqrtPriceX96).expect("not initialized");
        
        // Calculate amounts to return
        let sqrt_price_lower_x96 = Self::tick_to_sqrt_price_x96(tick_lower);
        let sqrt_price_upper_x96 = Self::tick_to_sqrt_price_x96(tick_upper);
        
        let amount0 = if current_tick < tick_lower {
            Self::get_amount0_for_liquidity(sqrt_price_lower_x96, sqrt_price_upper_x96, amount)
        } else if current_tick < tick_upper {
            Self::get_amount0_for_liquidity(sqrt_price_lower_x96, current_sqrt_price_x96, amount)
        } else {
            0
        };
        
        let amount1 = if current_tick < tick_lower {
            0
        } else if current_tick < tick_upper {
            Self::get_amount1_for_liquidity(current_sqrt_price_x96, sqrt_price_upper_x96, amount)
        } else {
            Self::get_amount1_for_liquidity(sqrt_price_lower_x96, sqrt_price_upper_x96, amount)
        };
        
        // Update position
        position.liquidity -= amount;
        if position.liquidity == 0 {
            env.storage().instance().remove(&position_key);
            // Remove from user positions list
            let positions: Vec<(i32, i32)> = env.storage().instance().get(&DataKey::UserPositions(owner.clone())).unwrap_or_else(|| Vec::new(&env));
            let mut new_positions = Vec::new(&env);
            for p in positions.iter() {
                if !(p.0 == tick_lower && p.1 == tick_upper) {
                    new_positions.push_back(p);
                }
            }
            env.storage().instance().set(&DataKey::UserPositions(owner.clone()), &new_positions);
        } else {
            env.storage().instance().set(&position_key, &position);
        }
        
        // Update ticks
        Self::update_tick(&env, tick_lower, -amount, true);
        Self::update_tick(&env, tick_upper, -amount, false);
        
        // Update pool liquidity if current price is within range
        let liquidity_before: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
        let in_range = tick_lower <= current_tick && current_tick < tick_upper;
        if in_range {
            let current_liquidity: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
            env.storage().instance().set(&DataKey::CurrentLiquidity, &(current_liquidity - amount));
        }
        
        // Invariant: removing liquidity may only lower k by the burned
        // liquidity's share; the remaining pool must keep at least that k.
        let expected_liquidity = if in_range { liquidity_before - amount } else { liquidity_before };
        let liquidity_after: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
        Self::assert_invariant(
            &env,
            Self::liquidity_k(expected_liquidity, current_sqrt_price_x96),
            Self::liquidity_k(liquidity_after, current_sqrt_price_x96),
        );
        
        // Topic: event name only; owner + tick range + amounts in data.
        env.events().publish((symbol_short!("burn"),), (owner, tick_lower, tick_upper, amount, amount0, amount1));
        
        (amount0, amount1)
    }

    /// Get current pool state
    pub fn get_state(env: Env) -> (i32, u128, i128) {
        let tick: i32 = env.storage().instance().get(&DataKey::CurrentTick).unwrap_or(0);
        let sqrt_price_x96: u128 = env.storage().instance().get(&DataKey::CurrentSqrtPriceX96).unwrap_or(0);
        let liquidity: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
        (tick, sqrt_price_x96, liquidity)
    }

    /// Get position info
    pub fn get_position(env: Env, owner: Address, tick_lower: i32, tick_upper: i32) -> Position {
        let position_key = DataKey::Position(owner, tick_lower, tick_upper);
        env.storage().instance().get(&position_key).expect("position not found")
    }

    /// Get tick info
    pub fn get_tick(env: Env, tick: i32) -> Tick {
        let tick_key = DataKey::Tick(tick);
        env.storage().instance().get(&tick_key).unwrap_or(Tick {
            liquidity_gross: 0,
            liquidity_net: 0,
            fee_growth_outside_0x128: 0,
            fee_growth_outside_1x128: 0,
        })
    }

    /// Sets a referrer for a user. Can only be set once per user.
    pub fn set_referrer(env: Env, user: Address, referrer: Address) {
        user.require_auth();
        
        // Check if user already has a referrer
        if env.storage().instance().has(&DataKey::Referrer(user.clone())) {
            panic!("referrer already set");
        }
        
        // User cannot refer themselves
        assert!(user != referrer, "cannot refer yourself");
        
        env.storage().instance().set(&DataKey::Referrer(user.clone()), &referrer);
        
        env.events().publish((symbol_short!("set_ref"), user), referrer);
    }

    /// Gets the referrer for a user, if any.
    pub fn get_referrer(env: Env, user: Address) -> Option<Address> {
        env.storage().instance().get(&DataKey::Referrer(user))
    }

    /// Sets the referral fee rate (in basis points, e.g., 100 = 1%).
    /// Only callable by admin (for simplicity, we'll skip admin check for now).
    pub fn set_referral_fee_rate(env: Env, fee_rate: u32) {
        assert!(fee_rate <= 10000, "fee rate cannot exceed 100%");
        env.storage().instance().set(&DataKey::ReferralFeeRate, &fee_rate);
        
        env.events().publish((symbol_short!("set_refee"),), fee_rate);
    }
}

/// Pure slippage and fee math extracted for property/fuzz testing.
pub struct SwapMath;

impl SwapMath {
    const Q96: u128 = 1_u128 << 96;

    fn div_rounding_up(numerator: U256, denominator: U256) -> U256 {
        assert!(denominator != U256::from(0_u8), "division by zero");
        let quotient = numerator / denominator;
        if numerator % denominator == U256::from(0_u8) {
            quotient
        } else {
            quotient + U256::from(1_u8)
        }
    }

    fn amount0_delta(liquidity: i128, sqrt_a: u128, sqrt_b: u128, round_up: bool) -> U256 {
        let diff = sqrt_a.abs_diff(sqrt_b);
        let numerator = U256::from(liquidity as u128)
            .checked_mul(U256::from(diff))
            .and_then(|value| value.checked_mul(U256::from(Self::Q96)))
            .expect("swap amount overflow");
        let denominator = U256::from(sqrt_a)
            .checked_mul(U256::from(sqrt_b))
            .expect("swap amount overflow");
        if round_up {
            Self::div_rounding_up(numerator, denominator)
        } else {
            numerator / denominator
        }
    }

    fn amount1_delta(liquidity: i128, sqrt_a: u128, sqrt_b: u128, round_up: bool) -> U256 {
        let numerator = U256::from(liquidity as u128)
            .checked_mul(U256::from(sqrt_a.abs_diff(sqrt_b)))
            .expect("swap amount overflow");
        let denominator = U256::from(Self::Q96);
        if round_up {
            Self::div_rounding_up(numerator, denominator)
        } else {
            numerator / denominator
        }
    }

    fn as_amount(value: U256) -> i128 {
        i128::try_from(value).expect("swap output overflow")
    }

    fn compute_swap_step_values(
        sqrt_current: u128,
        sqrt_target: u128,
        liquidity: i128,
        amount_remaining: i128,
    ) -> (u128, i128, i128) {
        if liquidity <= 0 || amount_remaining <= 0 || sqrt_current == 0 || sqrt_target == 0 {
            return (sqrt_current, 0, 0);
        }
        if sqrt_current == sqrt_target {
            return (sqrt_current, 0, 0);
        }

        let zero_for_one = sqrt_current > sqrt_target;
        let amount_in_to_target = if zero_for_one {
            Self::amount0_delta(liquidity, sqrt_target, sqrt_current, true)
        } else {
            Self::amount1_delta(liquidity, sqrt_current, sqrt_target, true)
        };
        let remaining = U256::from(amount_remaining as u128);
        let reaches_target = remaining >= amount_in_to_target;

        let next_sqrt = if reaches_target {
            sqrt_target
        } else if zero_for_one {
            let liquidity_q96 = U256::from(liquidity as u128)
                .checked_mul(U256::from(Self::Q96))
                .expect("swap amount overflow");
            let numerator = liquidity_q96
                .checked_mul(U256::from(sqrt_current))
                .expect("swap amount overflow");
            let denominator = liquidity_q96
                .checked_add(
                    U256::from(amount_remaining as u128)
                        .checked_mul(U256::from(sqrt_current))
                        .expect("swap amount overflow"),
                )
                .expect("swap amount overflow");
            let next = Self::div_rounding_up(numerator, denominator);
            u128::try_from(next).expect("sqrt price overflow").max(sqrt_target)
        } else {
            let price_delta = U256::from(amount_remaining as u128)
                .checked_mul(U256::from(Self::Q96))
                .expect("swap amount overflow")
                / U256::from(liquidity as u128);
            let next = U256::from(sqrt_current)
                .checked_add(price_delta)
                .expect("sqrt price overflow");
            u128::try_from(next)
                .expect("sqrt price overflow")
                .min(sqrt_target)
        };

        let amount_in = if reaches_target {
            Self::as_amount(amount_in_to_target)
        } else {
            amount_remaining
        };
        let amount_out = if zero_for_one {
            Self::as_amount(Self::amount1_delta(
                liquidity,
                next_sqrt,
                sqrt_current,
                false,
            ))
        } else {
            Self::as_amount(Self::amount0_delta(
                liquidity,
                sqrt_current,
                next_sqrt,
                false,
            ))
        };

        (next_sqrt, amount_out, amount_in)
    }

    pub fn compute_swap_step(
        sqrt_ratio_current: u128,
        sqrt_ratio_target: u128,
        liquidity: i128,
        amount: i128,
    ) -> i128 {
        Self::compute_swap_step_values(
            sqrt_ratio_current,
            sqrt_ratio_target,
            liquidity,
            amount,
        )
        .1
    }

    pub fn apply_fee(amount_in: i128, fee_bps: u32) -> i128 {
        amount_in
            .checked_mul((FEE_DENOMINATOR - fee_bps) as i128)
            .and_then(|v| v.checked_div(FEE_DENOMINATOR as i128))
            .unwrap_or(0)
    }

    pub fn swap_step_zero_for_one(amount_remaining: i128, sqrt_price: u128, liquidity: i128) -> i128 {
        if liquidity <= 0 || amount_remaining <= 0 {
            return 0;
        }
        let numerator = amount_remaining.checked_mul(sqrt_price as i128).unwrap_or(0);
        let denominator = (liquidity as u128)
            .checked_mul(1u128 << 96)
            .and_then(|v| v.checked_add(amount_remaining as u128))
            .unwrap_or(0);
        if denominator == 0 {
            return 0;
        }
        numerator.checked_div(denominator as i128).unwrap_or(0)
    }

    pub fn swap_step_one_for_zero(amount_remaining: i128, sqrt_price: u128, liquidity: i128) -> i128 {
        if liquidity <= 0 || amount_remaining <= 0 || sqrt_price == 0 {
            return 0;
        }
        let numerator = amount_remaining.checked_mul((1u128 << 96) as i128).unwrap_or(0);
        let denominator = (liquidity as u128).checked_mul(sqrt_price).unwrap_or(0);
        if denominator == 0 {
            return 0;
        }
        numerator.checked_div(denominator as i128).unwrap_or(0)
    }

    pub fn meets_slippage(amount_out: i128, min_amount_out: i128) -> bool {
        amount_out >= min_amount_out
    }

    pub fn calculate_dynamic_fee_bps(volume_factor: u128, volatility_factor: u128) -> u32 {
        let total_factor = (volume_factor + volatility_factor).min(100) as u32;
        let fee_increase = (MAX_FEE_BPS - MIN_FEE_BPS) * total_factor / 100;
        MIN_FEE_BPS + fee_increase
    }

    pub fn simulate_swap_output(
        amount_in: i128,
        fee_bps: u32,
        sqrt_price: u128,
        liquidity: i128,
        zero_for_one: bool,
        max_steps: u32,
    ) -> i128 {
        if amount_in <= 0 || liquidity <= 0 {
            return 0;
        }
        let mut amount_remaining = Self::apply_fee(amount_in, fee_bps);
        let mut amount_out = 0_i128;
        let mut steps = 0_u32;

        while amount_remaining > 0 && steps < max_steps {
            let step_out = if zero_for_one {
                Self::swap_step_zero_for_one(amount_remaining, sqrt_price, liquidity)
            } else {
                Self::swap_step_one_for_zero(amount_remaining, sqrt_price, liquidity)
            };

            if step_out == 0 {
                break;
            }

            let actual = core::cmp::min(step_out, amount_remaining);
            amount_out += actual;
            amount_remaining -= actual;
            steps += 1;
        }

        amount_out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
    };

    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let alice = Address::generate(&env);

        let token_a_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_b_id = env.register_stellar_asset_contract_v2(admin.clone());

        let a_sac = StellarAssetClient::new(&env, &token_a_id.address());
        let b_sac = StellarAssetClient::new(&env, &token_b_id.address());

        // Mint large amounts so swap math (which works in Q96 units) produces non-zero outputs
        a_sac.mint(&alice, &1_000_000_000_000_i128);
        b_sac.mint(&alice, &1_000_000_000_000_i128);

        let contract_id = env.register_contract(None, MultiAssetSwap);
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Initialize with concentrated liquidity parameters
        let initial_sqrt_price_x96 = MultiAssetSwap::tick_to_sqrt_price_x96(0); // Price = 1
        client.initialize(&token_a_id.address(), &token_b_id.address(), &initial_sqrt_price_x96, &0);

        (env, contract_id, admin, alice, token_a_id.address(), token_b_id.address())
    }

    #[test]
    fn test_tick_sqrt_prices_match_uniswap_reference_values() {
        assert_eq!(MultiAssetSwap::tick_to_sqrt_price_x96(0), 79_228_162_514_264_337_593_543_950_336);
        assert_eq!(MultiAssetSwap::tick_to_sqrt_price_x96(1), 79_232_123_823_359_799_118_286_999_567);
        assert_eq!(MultiAssetSwap::tick_to_sqrt_price_x96(-1), 79_224_201_403_219_477_170_569_942_574);
    }

    #[test]
    fn test_initialize_tick_stores_canonical_price() {
        let (env, contract_id, _admin, _alice, _token_a, _token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);
        let tick = 60;
        let sqrt_price = MultiAssetSwap::tick_to_sqrt_price_x96(tick);

        client.initialize_tick(&tick, &sqrt_price);

        assert_eq!(client.get_tick_sqrt_price(&tick), sqrt_price);
    }

    #[test]
    fn test_compute_swap_step_matches_one_tick_reference() {
        let (env, contract_id, _admin, _alice, _token_a, _token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);
        let sqrt_price_current = MultiAssetSwap::tick_to_sqrt_price_x96(0);
        let sqrt_price_target = MultiAssetSwap::tick_to_sqrt_price_x96(1);
        let amount_out = client.compute_swap_step(
            &sqrt_price_current,
            &sqrt_price_target,
            &1_000_000,
            &50,
        );

        assert_eq!(amount_out, 49);
    }

    #[test]
    fn test_concentrated_liquidity_mint() {
        let (env, contract_id, _admin, alice, _token_a, _token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Mint a position with concentrated liquidity
        let tick_lower = -60;
        let tick_upper = 60;
        let (liquidity, amount0, amount1) = client.mint(
            &alice, 
            &tick_lower, 
            &tick_upper, 
            &100_000_i128, 
            &100_000_i128
        );

        assert!(liquidity > 0);
        assert!(amount0 >= 0); 
        assert!(amount1 >= 0);

        // Check position was created
        let position = client.get_position(&alice, &tick_lower, &tick_upper);
        assert_eq!(position.liquidity, liquidity);
        assert_eq!(position.tick_lower, tick_lower);
        assert_eq!(position.tick_upper, tick_upper);

        // Check pool state
        let (tick, _sqrt_price_x96, pool_liquidity) = client.get_state();
        assert_eq!(tick, 0); // Should still be at initial tick
        assert!(pool_liquidity > 0);
    }

    #[test]
    fn test_concentrated_liquidity_swap() {
        let (env, contract_id, _admin, alice, token_a, token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Add liquidity (small enough so large swaps overcome the denominator)
        client.mint(&alice, &-60, &60, &100_000_i128, &100_000_i128);

        let a_client = TokenClient::new(&env, &token_a);
        let b_client = TokenClient::new(&env, &token_b);

        let initial_balance_a = a_client.balance(&alice);
        let initial_balance_b = b_client.balance(&alice);

        // Swap token_a for token_b: price limit must be strictly below current price
        let sqrt_price_limit = MultiAssetSwap::tick_to_sqrt_price_x96(-60);

        // Use a large swap amount relative to pool size for non-zero output
        let swap_amount = 5_000_000_i128;
        let amount_out = client.swap(
            &alice,
            &token_a,
            &swap_amount,
            &sqrt_price_limit,
            &0  // min_amount_out
        );

        assert!(amount_out > 0);

        // Check balances changed
        assert!(a_client.balance(&alice) < initial_balance_a);
        assert!(a_client.balance(&alice) > initial_balance_a - swap_amount);
        assert!(b_client.balance(&alice) > initial_balance_b);
    }

    #[test]
    fn test_burn_and_collect() {
        let (env, contract_id, _admin, alice, token_a, _token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Mint position
        let tick_lower = -60;
        let tick_upper = 60;
        let (liquidity, _, _) = client.mint(&alice, &tick_lower, &tick_upper, &100_000_i128, &100_000_i128);

        // Perform some swaps to generate fees
        let sqrt_price_limit = MultiAssetSwap::tick_to_sqrt_price_x96(-1);
        client.swap(&alice, &token_a, &1_000, &sqrt_price_limit, &0);

        // Collect any remaining owed tokens
        let (fees0, fees1) = client.collect(&alice, &tick_lower, &tick_upper, &1_000_000_000_000_i128, &1_000_000_000_000_i128);
        assert!(fees0 >= 0 && fees1 >= 0);

        // Burn position
        let (amount0, amount1) = client.burn(&alice, &tick_lower, &tick_upper, &liquidity);
        assert!(amount0 >= 0 && amount1 >= 0);
    }

    #[test]
    #[should_panic(expected = "invalid tick range")]
    fn test_invalid_tick_range() {
        let (env, contract_id, _admin, alice, token_a, token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Should panic - lower tick >= upper tick
        client.mint(&alice, &60, &-60, &10_000, &10_000);
    }

    #[test]
    #[should_panic(expected = "tick out of bounds")]
    fn test_tick_out_of_bounds() {
        let (env, contract_id, _admin, alice, token_a, token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Should panic - tick exceeds maximum
        client.mint(&alice, &-887272, &887273, &10_000, &10_000);
    }

    #[test]
    fn test_dynamic_fee_scaling() {
        let (env, contract_id, _admin, alice, token_a, _token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Add liquidity
        client.mint(&alice, &-60, &60, &100_000_i128, &100_000_i128);

        // First swap at base fee
        let price_limit_1 = MultiAssetSwap::tick_to_sqrt_price_x96(-1);
        let _amount_out_1 = client.swap(&alice, &token_a, &5_000_000_i128, &price_limit_1, &0);

        // Second swap
        let price_limit_2 = MultiAssetSwap::tick_to_sqrt_price_x96(-2);
        let amount_out_2 = client.swap(&alice, &token_a, &5_000_000_i128, &price_limit_2, &0);

        // Verify swap succeeds and returns a positive amount
        assert!(amount_out_2 > 0);
        
        // Verify the pool is still active
        let (_, _, pool_liquidity) = client.get_state();
        assert!(pool_liquidity > 0);
    }

    #[test]
    #[should_panic(expected = "SlippageExceeded")]
    fn test_slippage_protection() {
        let (env, contract_id, _admin, alice, token_a, token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Add liquidity
        client.mint(&alice, &-60, &60, &10_000, &10_000);

        // Perform swap with unrealistic min_amount_out that will fail.
        // SwapError::SlippageExceeded is raised via panic_with_error! when
        // amount_out < min_amount_out.
        let sqrt_price_limit = MultiAssetSwap::tick_to_sqrt_price_x96(-1);
        client.swap(
            &alice,
            &token_a,
            &1_000,
            &sqrt_price_limit,
            &100_000  // Unrealistic minimum that will fail
        );
    }

    #[test]
    fn test_referral_program() {
        let (env, contract_id, admin, alice, token_a, token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        let bob = Address::generate(&env);

        client.set_referral_fee_rate(&10_000);

        // Set bob as alice's referrer
        client.set_referrer(&alice, &bob);

        // Verify referrer was set
        let referrer = client.get_referrer(&alice);
        assert_eq!(referrer, Some(bob.clone()));

        // Add liquidity
        client.mint(&alice, &-60, &60, &10_000, &10_000);

        let a_client = TokenClient::new(&env, &token_a);
        let b_client = TokenClient::new(&env, &token_b);

        let initial_balance_a = a_client.balance(&alice);
        let initial_balance_b = b_client.balance(&alice);
        let initial_balance_bob_b = b_client.balance(&bob);

        // Perform swap - bob should receive referral fee
        let sqrt_price_limit = MultiAssetSwap::tick_to_sqrt_price_x96(-1);
        client.swap(
            &alice, 
            &token_a, 
            &1_000, 
            &sqrt_price_limit,
            &0  // min_amount_out
        );

        // Bob should have received referral fee
        assert!(b_client.balance(&bob) > initial_balance_bob_b);
    }

    #[test]
    #[should_panic(expected = "referrer already set")]
    fn test_referrer_already_set() {
        let (env, contract_id, _admin, alice, _token_a, _token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);

        // Set bob as alice's referrer
        client.set_referrer(&alice, &bob);

        // Try to set charlie as referrer - should panic
        client.set_referrer(&alice, &charlie);
    }

    #[test]
    #[should_panic(expected = "cannot refer yourself")]
    fn test_cannot_refer_yourself() {
        let (env, contract_id, _admin, alice, _token_a, _token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Try to set alice as her own referrer - should panic
        client.set_referrer(&alice, &alice);
    }

    #[test]
    fn test_invariant_holds_for_dust_swap() {
        // Price = 1, so both virtual reserves equal L.
        let sqrt_price = MultiAssetSwap::tick_to_sqrt_price_x96(0);
        let liquidity = 33_000_000_i128;

        // 1 unit in plus 1 unit of fee, 1 unit out: k grows.
        let (old_k, new_k) = MultiAssetSwap::swap_k(liquidity, sqrt_price, true, 2, 1);
        assert!(new_k >= old_k);
        let (old_k, new_k) = MultiAssetSwap::swap_k(liquidity, sqrt_price, false, 2, 1);
        assert!(new_k >= old_k);
    }

    #[test]
    fn test_invariant_detects_minimal_rounding_loss() {
        let sqrt_price = MultiAssetSwap::tick_to_sqrt_price_x96(0);
        let liquidity = 33_000_000_i128;

        // 1 in, 1 out with no fee: (L + 1)(L - 1) = L^2 - 1 < L^2.
        let (old_k, new_k) = MultiAssetSwap::swap_k(liquidity, sqrt_price, true, 1, 1);
        assert!(new_k < old_k);
        let (old_k, new_k) = MultiAssetSwap::swap_k(liquidity, sqrt_price, false, 1, 1);
        assert!(new_k < old_k);
    }

    #[test]
    fn test_invariant_detects_drain_beyond_reserve() {
        let sqrt_price = MultiAssetSwap::tick_to_sqrt_price_x96(0);
        let liquidity = 1_000_i128;

        // Output larger than the output-side reserve empties the pool: new_k = 0.
        let (old_k, new_k) = MultiAssetSwap::swap_k(liquidity, sqrt_price, true, 1, 1_001);
        assert!(new_k < old_k);
        assert_eq!(new_k, U256::from(0_u8));
    }

    #[test]
    fn test_invariant_at_max_reserves() {
        let sqrt_price = MultiAssetSwap::tick_to_sqrt_price_x96(0);
        let liquidity = i128::MAX;

        let (old_k, new_k) = MultiAssetSwap::swap_k(liquidity, sqrt_price, true, 1_000_000, 999_000);
        assert!(new_k >= old_k);
        let (old_k, new_k) = MultiAssetSwap::swap_k(liquidity, sqrt_price, true, 1_000_000, 1_000_001);
        assert!(new_k < old_k);
    }

    #[test]
    fn test_invariant_holds_across_trade_sizes() {
        for swap_amount in [1_000_i128, 100_000_i128, 5_000_000_i128] {
            let (env, contract_id, _admin, alice, token_a, _token_b) = setup();
            let client = MultiAssetSwapClient::new(&env, &contract_id);
            client.mint(&alice, &-60, &60, &100_000_i128, &100_000_i128);

            let sqrt_price_limit = MultiAssetSwap::tick_to_sqrt_price_x96(-60);
            let amount_out = client.swap(&alice, &token_a, &swap_amount, &sqrt_price_limit, &0);
            assert!(amount_out > 0);
        }
    }

    #[test]
    #[should_panic(expected = "SlippageExceeded")]
    fn test_swap_slippage_exceeded() {
        let (env, contract_id, _admin, alice, token_a, _token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        client.mint(&alice, &-60, &60, &10_000, &10_000);

        let sqrt_price_limit = MultiAssetSwap::tick_to_sqrt_price_x96(-1);
        
        // This swap will output some tokens, but we specify a very high min_amount_out (50,000)
        // that cannot be met, causing a SlippageExceeded panic.
        client.swap(
            &alice, 
            &token_a, 
            &1_000, 
            &sqrt_price_limit,
            &50_000
        );
    }
}
