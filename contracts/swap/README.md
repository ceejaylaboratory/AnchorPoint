# Concentrated Liquidity AMM (Uniswap V3-style)

This contract implements an automated market maker (AMM) with concentrated liquidity, similar to Uniswap V3. It allows liquidity providers to allocate capital to specific price ranges, enabling capital efficiency and fee optimization.

## Key Features

### Concentrated Liquidity
- Liquidity providers can specify custom price ranges (tick boundaries)
- Capital efficiency: More liquidity depth where trading occurs
- Multiple positions per user with different ranges

### Tick-based Price System
- Price represented as ticks with 0.01% price increments (1.0001^tick)
- Tick spacing: 60 (default) for 0.6% price intervals
- Price range: -887272 to 887272 ticks

### Fee Mechanism
- 0.3% trading fee (3000 basis points)
- Fees distributed to active liquidity positions
- Fee growth tracking for accurate position value calculation

## Core Data Structures

### Position
```rust
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
```

### Tick
```rust
pub struct Tick {
    pub liquidity_gross: i128,
    pub liquidity_net: i128,
    pub fee_growth_outside_0x128: i128,
    pub fee_growth_outside_1x128: i128,
}
```

## Storage Optimization

### Efficient Mappings
- `Tick(i32)` -> Tick data for price boundaries
- `Position(Address, i32, i32)` -> User positions by owner and range
- `UserPositions(Address)` -> List of user's position ranges

### Gas Optimization
- Tick data only stored at initialized ticks
- Position updates batched when possible
- Minimal storage reads during swaps

## Key Functions

### Pool Initialization
```rust
initialize(token_a: Address, token_b: Address, sqrt_price_x96: u128, tick: i32)
```

### Liquidity Management
```rust
mint(recipient: Address, tick_lower: i32, tick_upper: i32, amount0_desired: i128, amount1_desired: i128) -> (i128, i128, i128)

burn(owner: Address, tick_lower: i32, tick_upper: i32, amount: i128) -> (i128, i128)

collect(recipient: Address, tick_lower: i32, tick_upper: i32, amount0_requested: i128, amount1_requested: i128) -> (i128, i128)
```

### Trading
```rust
swap(recipient: Address, token_in: Address, amount_in: i128, sqrt_price_limit_x96: u128) -> i128
```

### View Functions
```rust
get_state() -> (i32, u128, i128)  // (current_tick, sqrt_price_x96, liquidity)

get_position(owner: Address, tick_lower: i32, tick_upper: i32) -> Position

get_tick(tick: i32) -> Tick
```

## Price Calculations

### Tick to Sqrt Price
```rust
tick_to_sqrt_price_x96(tick: i32) -> u128
// Returns: sqrt(1.0001^tick) * 2^96
```

### Liquidity Calculations
```rust
get_liquidity_for_amount0(sqrt_ratio_a_x96: u128, sqrt_ratio_b_x96: u128, amount0: i128) -> i128
get_liquidity_for_amount1(sqrt_ratio_a_x96: u128, sqrt_ratio_b_x96: u128, amount1: i128) -> i128
get_amount0_for_liquidity(sqrt_ratio_a_x96: u128, sqrt_ratio_b_x96: u128, liquidity: i128) -> i128
get_amount1_for_liquidity(sqrt_ratio_a_x96: u128, sqrt_ratio_b_x96: u128, liquidity: i128) -> i128
```

## Usage Examples

### Creating a Position
```rust
// Initialize pool
let initial_price = MultiAssetSwap::tick_to_sqrt_price_x96(0); // Price = 1
pool.initialize(token_a, token_b, initial_price, 0);

// Create position around current price
let tick_lower = -60;  // ~0.4% below current price
let tick_upper = 60;   // ~0.4% above current price
let (liquidity, amount0, amount1) = pool.mint(
    user_address,
    tick_lower,
    tick_upper,
    1000,  // desired amount0
    1000   // desired amount1
);
```

### Performing a Swap
```rust
// Swap token0 for token1
let sqrt_price_limit = MultiAssetSwap::tick_to_sqrt_price_x96(-1); // Minimum acceptable price
let amount_out = pool.swap(
    user_address,
    token_a,
    100,  // amount_in
    sqrt_price_limit
);
```

### Removing Liquidity
```rust
// Burn liquidity position
let (amount0, amount1) = pool.burn(
    user_address,
    tick_lower,
    tick_upper,
    liquidity_amount
);

// Collect accumulated fees
let (fees0, fees1) = pool.collect(
    user_address,
    tick_lower,
    tick_upper,
    u128::MAX,  // max fees to collect
    u128::MAX
);
```

## Mathematical Foundation

### Price Representation
Prices are stored as sqrt(P) * 2^96 to enable:
- Integer arithmetic for price calculations
- Efficient liquidity computations
- Consistent precision across price ranges

### Liquidity as L
Liquidity (L) represents the amount of virtual tokens available at each price point:
- L = amount0 * sqrt(P) when P ≤ Pa
- L = amount1 / sqrt(P) when P ≥ Pb
- L = amount0 * sqrt(P) = amount1 / sqrt(P) when Pa < P < Pb

### Fee Growth
Fee growth tracks cumulative fees per unit of liquidity:
- Enables accurate position value calculation
- Fees are only earned when price is within position range
- Compounded on each swap

## Security Considerations

### Tick Validation
- Ticks must be within valid bounds (-887272 to 887272)
- Tick spacing enforced (multiples of 60)
- Lower tick must be less than upper tick

### Price Limits
- Swaps include sqrt_price_limit for slippage protection
- Price limits validated against current price
- Prevents sandwich attacks beyond specified tolerance

### Liquidity Bounds
- Position liquidity cannot exceed available tokens
- Burn operations limited to position liquidity
- Pool liquidity updated atomically

## Testing

The contract includes comprehensive tests covering:
- Position creation and management
- Swap execution with various price scenarios
- Fee calculation and collection
- Edge cases and error conditions

Run tests with:
```bash
cargo test
```

## Gas Optimization Notes

### Storage Efficiency
- Tick data only stored at initialized boundaries
- Position updates batched when possible
- Minimal storage reads during operations

### Computational Efficiency
- Integer arithmetic throughout
- Optimized tick traversal logic
- Efficient fee growth calculations

### Event Emission
- Structured events for off-chain indexing
- Minimal event data to reduce gas costs
- Critical state changes always emitted

## Future Enhancements

### Multiple Fee Tiers
- Support for 0.05%, 0.3%, and 1% fee tiers
- Separate pools per fee tier
- Dynamic fee allocation based on volume

### Advanced Features
- Limit orders via single-sided positions
- TWAP oracle integration
- Liquidity mining incentives

### Performance Optimizations
- Tick bitmap for efficient traversal
- Batch position updates
- Optimized swap path finding
