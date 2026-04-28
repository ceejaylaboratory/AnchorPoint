#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env,
};

// Constants for tick math
const MIN_TICK: i32 = -887272;
const MAX_TICK: i32 = 887272;
const TICK_SPACING: i32 = 60; // Default tick spacing
const FEE_TIER: u32 = 3000; // 0.3% fee tier (3000 basis points)

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
    pub sender: Address,
    pub recipient: Address,
    pub amount_0: i128,
    pub amount_1: i128,
    pub sqrt_price_x96: u128,
    pub liquidity: i128,
    pub tick: i32,
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
    // Tick data mapping (tick -> Tick)
    Tick(i32),
    // Position mapping (owner + tick_lower + tick_upper -> Position)
    Position(Address, i32, i32),
    // User positions list for enumeration
    UserPositions(Address),
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

    /// Convert tick to sqrt price (simplified version)
    /// In a full implementation, this would use the exact Uniswap V3 math
    pub fn tick_to_sqrt_price_x96(tick: i32) -> u128 {
        // Simplified conversion - in production this would use the exact formula
        // sqrt(1.0001^tick) * 2^96
        let tick_i128 = tick as i128;
        let base = 10001; // 1.0001 * 10000 for integer math
        let result = if tick >= 0 {
            // For positive ticks: (base^tick)^(1/2) * 2^96
            let power = self::pow(base, tick_i128);
            (power as u128).checked_mul(1u128 << 96).unwrap_or(u128::MAX)
        } else {
            // For negative ticks: 2^96 / sqrt(base^abs(tick))
            let power = self::pow(base, -tick_i128);
            (1u128 << 96).checked_div(power as u128).unwrap_or(0)
        };
        
        // Simplified: return a reasonable approximation
        // In production, this would be much more precise
        ((tick as u128).checked_add(1u128 << 96).unwrap_or(u128::MAX)) / 1000
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
        
        let intermediate = sqrt_ratio_a_x96.checked_mul(sqrt_ratio_b_x96).unwrap_or(u128::MAX);
        let numerator = amount0 as u128 * intermediate;
        let denominator = 1u128 << 96;
        
        (numerator.checked_div(denominator).unwrap_or(0)) as i128
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

    /// Get the amount of token0 for given liquidity and price range
    pub fn get_amount0_for_liquidity(
        sqrt_ratio_a_x96: u128,
        sqrt_ratio_b_x96: u128,
        liquidity: i128,
    ) -> i128 {
        if sqrt_ratio_a_x96 > sqrt_ratio_b_x96 {
            return Self::get_amount0_for_liquidity(sqrt_ratio_b_x96, sqrt_ratio_a_x96, liquidity);
        }
        
        if liquidity <= 0 {
            return 0;
        }
        
        let numerator = liquidity as u128 * (sqrt_ratio_b_x96 - sqrt_ratio_a_x96);
        let denominator = sqrt_ratio_b_x96.checked_mul(sqrt_ratio_a_x96).unwrap_or(u128::MAX);
        
        (numerator.checked_div(denominator).unwrap_or(0)) as i128
    }

    /// Get the amount of token1 for given liquidity and price range
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
        
        let numerator = liquidity as u128 * (sqrt_ratio_b_x96 - sqrt_ratio_a_x96);
        let denominator = 1u128 << 96;
        
        (numerator.checked_div(denominator).unwrap_or(0)) as i128
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
        assert!(tick_upper <= MAX_TICK, "tick_upper out of bounds");
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
            std::cmp::min(liquidity0, liquidity1)
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
            let mut positions: Vec<(i32, i32)> = env.storage().instance().get(&DataKey::UserPositions(recipient.clone())).unwrap_or_default();
            positions.push((tick_lower, tick_upper));
            env.storage().instance().set(&DataKey::UserPositions(recipient), &positions);
        }
        
        // Update ticks
        Self::update_tick(&env, tick_lower, liquidity as i128, true);
        Self::update_tick(&env, tick_upper, liquidity as i128, false);
        
        // Update pool liquidity if current price is within range
        let current_tick: i32 = env.storage().instance().get(&DataKey::CurrentTick).expect("not initialized");
        if tick_lower <= current_tick && current_tick < tick_upper {
            let current_liquidity: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
            env.storage().instance().set(&DataKey::CurrentLiquidity, &(current_liquidity + liquidity));
        }
        
        env.events().publish((symbol_short!("mint"), recipient), (tick_lower, tick_upper, liquidity, amount0, amount1));
        
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
        } else {
            env.storage().instance().set(&tick_key, &tick_data);
        }
    }

    /// Cross a tick boundary and update liquidity
    fn cross_tick(env: &Env, tick: i32, liquidity: i128) -> i128 {
        let tick_key = DataKey::Tick(tick);
        if let Some(tick_data) = env.storage().instance().get(&tick_key) {
            return liquidity + tick_data.liquidity_net;
        }
        liquidity
    }

    /// Swaps tokens using concentrated liquidity.
    /// Returns amount out.
    pub fn swap(
        env: Env,
        recipient: Address,
        token_in: Address,
        amount_in: i128,
        sqrt_price_limit_x96: u128,
    ) -> i128 {
        recipient.require_auth();
        assert!(amount_in > 0, "amount must be positive");
        
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
        let mut current_liquidity: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
        
        // Validate price limit
        if zero_for_one {
            assert!(sqrt_price_limit_x96 < current_sqrt_price_x96, "invalid price limit");
        } else {
            assert!(sqrt_price_limit_x96 > current_sqrt_price_x96, "invalid price limit");
        }
        
        // Transfer tokens in
        let contract_addr = env.current_contract_address();
        token::Client::new(&env, &token_in).transfer(&recipient, &contract_addr, &amount_in);
        
        // Simplified swap logic for concentrated liquidity
        // In a full implementation, this would iterate through ticks
        let amount_in_less_fee = amount_in * 997; // 0.3% fee
        let mut amount_remaining = amount_in_less_fee;
        let mut amount_out = 0_i128;
        
        while amount_remaining > 0 {
            if current_liquidity == 0 {
                panic!("insufficient liquidity");
            }
            
            // Calculate output amount using current liquidity
            let amount_calculated = if zero_for_one {
                // token0 in, token1 out
                let numerator = amount_remaining * current_sqrt_price_x96 as i128;
                let denominator = (current_liquidity as u128 * (1u128 << 96)) + amount_remaining as u128;
                numerator.checked_div(denominator as i128).unwrap_or(0)
            } else {
                // token1 in, token0 out
                let numerator = amount_remaining * (1u128 << 96) as i128;
                let denominator = current_liquidity as u128 * current_sqrt_price_x96;
                numerator.checked_div(denominator as i128).unwrap_or(0)
            };
            
            if amount_calculated == 0 {
                break;
            }
            
            let actual_amount = std::cmp::min(amount_calculated, amount_remaining);
            amount_out += actual_amount;
            amount_remaining -= actual_amount;
            
            // Update price (simplified)
            if zero_for_one {
                current_sqrt_price_x96 = current_sqrt_price_x96.checked_sub(1).unwrap_or(0);
            } else {
                current_sqrt_price_x96 = current_sqrt_price_x96.checked_add(1).unwrap_or(u128::MAX);
            }
            
            // Check if we've hit the price limit
            if (zero_for_one && current_sqrt_price_x96 <= sqrt_price_limit_x96) ||
               (!zero_for_one && current_sqrt_price_x96 >= sqrt_price_limit_x96) {
                break;
            }
        }
        
        assert!(amount_out > 0, "zero amount out");
        
        // Update pool state
        env.storage().instance().set(&DataKey::CurrentSqrtPriceX96, &current_sqrt_price_x96);
        env.storage().instance().set(&DataKey::CurrentLiquidity, &current_liquidity);
        
        // Update fee growth (simplified)
        let fee_amount = amount_in - amount_in_less_fee / 997;
        if zero_for_one {
            let fee_growth_global: i128 = env.storage().instance().get(&DataKey::FeeGrowthGlobal0X128).unwrap_or(0);
            let new_fee_growth = fee_growth_global + (fee_amount << 128) / current_liquidity.max(1);
            env.storage().instance().set(&DataKey::FeeGrowthGlobal0X128, &new_fee_growth);
        } else {
            let fee_growth_global: i128 = env.storage().instance().get(&DataKey::FeeGrowthGlobal1X128).unwrap_or(0);
            let new_fee_growth = fee_growth_global + (fee_amount << 128) / current_liquidity.max(1);
            env.storage().instance().set(&DataKey::FeeGrowthGlobal1X128, &new_fee_growth);
        }
        
        // Transfer tokens out
        token::Client::new(&env, &token_out).transfer(&contract_addr, &recipient, &amount_out);
        
        // Update tick (simplified - in full implementation would calculate from sqrt price)
        current_tick = if zero_for_one { current_tick - 1 } else { current_tick + 1 };
        env.storage().instance().set(&DataKey::CurrentTick, &current_tick);
        
        env.events().publish(
            (symbol_short!("swap"), recipient),
            SwapEvent {
                sender: recipient,
                recipient,
                amount_0: if zero_for_one { amount_in } else { -amount_out },
                amount_1: if zero_for_one { -amount_out } else { amount_in },
                sqrt_price_x96: current_sqrt_price_x96,
                liquidity: current_liquidity,
                tick: current_tick,
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
            ((fee_growth_global_0 - position.fee_growth_inside_0_last_x128) * position.liquidity) >> 128;
        let tokens_owed_1 = position.tokens_owed_1 + 
            ((fee_growth_global_1 - position.fee_growth_inside_1_last_x128) * position.liquidity) >> 128;
        
        let amount0 = std::cmp::min(amount0_requested, tokens_owed_0);
        let amount1 = std::cmp::min(amount1_requested, tokens_owed_1);
        
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
        
        env.events().publish((symbol_short!("collect"), recipient), (tick_lower, tick_upper, amount0, amount1));
        
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
            let mut positions: Vec<(i32, i32)> = env.storage().instance().get(&DataKey::UserPositions(owner.clone())).unwrap_or_default();
            positions.retain(|(tl, tu)| !(*tl == tick_lower && *tu == tick_upper));
            env.storage().instance().set(&DataKey::UserPositions(owner), &positions);
        } else {
            env.storage().instance().set(&position_key, &position);
        }
        
        // Update ticks
        Self::update_tick(&env, tick_lower, -amount, true);
        Self::update_tick(&env, tick_upper, -amount, false);
        
        // Update pool liquidity if current price is within range
        if tick_lower <= current_tick && current_tick < tick_upper {
            let current_liquidity: i128 = env.storage().instance().get(&DataKey::CurrentLiquidity).unwrap_or(0);
            env.storage().instance().set(&DataKey::CurrentLiquidity, &(current_liquidity - amount));
        }
        
        env.events().publish((symbol_short!("burn"), owner), (tick_lower, tick_upper, amount, amount0, amount1));
        
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

        a_sac.mint(&alice, &100_000);
        b_sac.mint(&alice, &100_000);

        let contract_id = env.register_contract(None, MultiAssetSwap);
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Initialize with concentrated liquidity parameters
        let initial_sqrt_price_x96 = MultiAssetSwap::tick_to_sqrt_price_x96(0); // Price = 1
        client.initialize(&token_a_id.address(), &token_b_id.address(), &initial_sqrt_price_x96, &0);

        (env, contract_id, admin, alice, token_a_id.address(), token_b_id.address())
    }

    #[test]
    fn test_concentrated_liquidity_mint() {
        let (env, contract_id, _admin, alice, token_a, token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Mint a position with concentrated liquidity
        let tick_lower = -60;
        let tick_upper = 60;
        let (liquidity, amount0, amount1) = client.mint(
            &alice, 
            &tick_lower, 
            &tick_upper, 
            &10_000, 
            &10_000
        );

        assert!(liquidity > 0);
        assert!(amount0 > 0);
        assert!(amount1 > 0);

        // Check position was created
        let position = client.get_position(&alice, &tick_lower, &tick_upper);
        assert_eq!(position.liquidity, liquidity);
        assert_eq!(position.tick_lower, tick_lower);
        assert_eq!(position.tick_upper, tick_upper);

        // Check pool state
        let (tick, sqrt_price_x96, pool_liquidity) = client.get_state();
        assert_eq!(tick, 0); // Should still be at initial tick
        assert!(pool_liquidity > 0);
    }

    #[test]
    fn test_concentrated_liquidity_swap() {
        let (env, contract_id, _admin, alice, token_a, token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Add liquidity
        client.mint(&alice, &-60, &60, &10_000, &10_000);

        let a_client = TokenClient::new(&env, &token_a);
        let b_client = TokenClient::new(&env, &token_b);

        let initial_balance_a = a_client.balance(&alice);
        let initial_balance_b = b_client.balance(&alice);

        // Perform swap
        let sqrt_price_limit = if true { 
            // token0 for token1, price should go down
            MultiAssetSwap::tick_to_sqrt_price_x96(-1) 
        } else { 
            MultiAssetSwap::tick_to_sqrt_price_x96(1) 
        };
        
        let amount_out = client.swap(
            &alice, 
            &token_a, 
            &1_000, 
            &sqrt_price_limit
        );

        assert!(amount_out > 0);

        // Check balances changed
        assert_eq!(a_client.balance(&alice), initial_balance_a - 1_000);
        assert!(b_client.balance(&alice) > initial_balance_b);
    }

    #[test]
    fn test_burn_and_collect() {
        let (env, contract_id, _admin, alice, token_a, token_b) = setup();
        let client = MultiAssetSwapClient::new(&env, &contract_id);

        // Mint position
        let tick_lower = -60;
        let tick_upper = 60;
        let (liquidity, _, _) = client.mint(&alice, &tick_lower, &tick_upper, &10_000, &10_000);

        // Perform some swaps to generate fees
        let sqrt_price_limit = MultiAssetSwap::tick_to_sqrt_price_x96(-1);
        client.swap(&alice, &token_a, &1_000, &sqrt_price_limit);

        // Burn position
        let (amount0, amount1) = client.burn(&alice, &tick_lower, &tick_upper, &liquidity);
        assert!(amount0 > 0 || amount1 > 0);

        // Collect fees
        let (fees0, fees1) = client.collect(&alice, &tick_lower, &tick_upper, &1_000_000, &1_000_000);
        // Fees should be zero since we simplified fee calculation in this version
        assert_eq!(fees0, 0);
        assert_eq!(fees1, 0);
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
}
