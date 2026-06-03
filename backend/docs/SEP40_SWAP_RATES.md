# SEP-40 Swap Rates Implementation

## Overview

SEP-40 provides a standardized way for wallets to request real-time swap rates for on-chain asset pairs managed by the anchor. This implementation allows clients to query swap rates for any supported asset pair.

## Endpoints

### POST /sep40/rates

Get swap rates for specified asset pairs.

**Request Body:**
```json
{
  "pairs": [
    {
      "sell_asset": "XLM",
      "buy_asset": "USDC"
    },
    {
      "sell_asset": "USDC",
      "buy_asset": "XLM"
    }
  ]
}
```

**Response:**
```json
{
  "rates": [
    {
      "sell_asset": "XLM",
      "buy_asset": "USDC",
      "rate": 0.12,
      "decimals": 7
    },
    {
      "sell_asset": "USDC",
      "buy_asset": "XLM",
      "rate": 8.33,
      "decimals": 7
    }
  ]
}
```

**Parameters:**
- `pairs` (required): Array of asset pairs to get rates for
  - `sell_asset` (required): Asset code to sell (e.g., "XLM", "USDC")
  - `buy_asset` (required): Asset code to buy (e.g., "USDC", "XLM")

**Response Fields:**
- `rates`: Array of swap rates
  - `sell_asset`: Asset code being sold
  - `buy_asset`: Asset code being bought
  - `rate`: Exchange rate (how many buy_asset units per sell_asset unit)
  - `decimals`: Number of decimal places for the rate

**Error Responses:**
- `400 Bad Request`: Missing or invalid parameters
- `500 Internal Server Error`: Server error

### GET /sep40/pairs

Get all supported asset pairs for swap rates.

**Response:**
```json
{
  "pairs": [
    {
      "sell_asset": "XLM",
      "buy_asset": "USDC"
    },
    {
      "sell_asset": "XLM",
      "buy_asset": "USDT"
    },
    {
      "sell_asset": "USDC",
      "buy_asset": "XLM"
    }
  ]
}
```

**Response Fields:**
- `pairs`: Array of all supported asset pairs
  - `sell_asset`: Asset code being sold
  - `buy_asset`: Asset code being bought

## Supported Assets

The following assets are currently supported:

- **XLM** - Stellar Lumens (native)
- **USDC** - USD Coin
- **USDT** - Tether
- **BTC** - Bitcoin
- **ETH** - Ethereum

## Implementation Details

### Rate Calculation

Swap rates are calculated based on mock pricing data. In a production environment, these rates would be sourced from:

1. Real-time market data APIs (e.g., CoinGecko, CoinMarketCap)
2. Internal pricing engines
3. DEX aggregators

### Rate Precision

All rates are returned with 7 decimal places of precision, consistent with Stellar's native precision.

### Bidirectional Rates

If a direct rate is not available, the system will calculate the inverse rate. For example:
- If XLM/USDC = 0.12, then USDC/XLM = 1/0.12 ≈ 8.33

### Error Handling

- Invalid asset pairs (e.g., same asset for both sell and buy) are filtered out
- Asset codes are normalized to uppercase
- Missing or malformed requests return appropriate HTTP error codes

## Usage Examples

### Example 1: Get rate for XLM to USDC

```bash
curl -X POST http://localhost:3000/sep40/rates \
  -H "Content-Type: application/json" \
  -d '{
    "pairs": [
      {
        "sell_asset": "XLM",
        "buy_asset": "USDC"
      }
    ]
  }'
```

### Example 2: Get multiple rates

```bash
curl -X POST http://localhost:3000/sep40/rates \
  -H "Content-Type: application/json" \
  -d '{
    "pairs": [
      { "sell_asset": "XLM", "buy_asset": "USDC" },
      { "sell_asset": "XLM", "buy_asset": "USDT" },
      { "sell_asset": "USDC", "buy_asset": "BTC" }
    ]
  }'
```

### Example 3: Get all supported pairs

```bash
curl http://localhost:3000/sep40/pairs
```

## Testing

Run the test suite:

```bash
npm test -- sep40.controller.test.ts
npm test -- sep40.route.test.ts
```

## Future Enhancements

1. **Database Persistence**: Store historical rates for analytics
2. **Real-time Updates**: WebSocket support for live rate updates
3. **Rate Caching**: Implement caching with configurable TTL
4. **Custom Pricing**: Allow anchors to configure custom pricing logic
5. **Rate Limits**: Implement per-client rate limiting
6. **Authentication**: Add API key authentication for rate queries

## References

- [SEP-40 Specification](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0040.md)
- [Stellar Asset Codes](https://developers.stellar.org/docs/learn/basics/assets)
