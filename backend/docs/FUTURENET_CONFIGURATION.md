# Futurenet Configuration Guide

This guide explains how to configure all backend services (Indexer, Stellar, Auth) to point to Stellar Futurenet for testing upcoming protocol features.

## Environment Variables

To configure the backend to use Stellar Futurenet, set the following environment variables in your `.env` file:

```bash
# Network selection (testnet, public, or futurenet)
STELLAR_NETWORK=futurenet

# Horizon URL for the Indexer service
HORIZON_URL=https://horizon-futurenet.stellar.org

# Stellar Horizon URL for the Stellar service
STELLAR_HORIZON_URL=https://horizon-futurenet.stellar.org

# Network passphrase for Auth and Batch services
STELLAR_NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"
```

## Service-Specific Configuration

### 1. Stellar Service

The Stellar service (`backend/src/services/stellar.service.ts`) automatically initializes from the `STELLAR_NETWORK` environment variable. It supports:

- **NetworkType.TESTNET** (default)
- **NetworkType.PUBLIC**
- **NetworkType.FUTURENET**

The service provides the following network configurations:
- Horizon URL
- Soroban RPC URL
- Network passphrase

### 2. Indexer Service

The Indexer service (`backend/src/services/indexer/indexer.service.ts`) uses the `HORIZON_URL` environment variable to resolve issuer home domains via Horizon. The HorizonResolver (`backend/src/services/indexer/horizon.resolver.ts`) has been updated to use the centralized configuration.

### 3. Auth Service

The Auth service (`backend/src/services/auth.service.ts` and `backend/src/api/controllers/auth.controller.ts`) uses the `STELLAR_NETWORK_PASSPHRASE` environment variable for SEP-10 authentication challenges. This is now configured through the centralized env config.

### 4. Batch Payment Service

The Batch Payment service (`backend/src/api/controllers/batch.controller.ts`) uses both `STELLAR_HORIZON_URL` and `STELLAR_NETWORK_PASSPHRASE` environment variables for transaction submission and network passphrase.

## Network Configurations

The network configurations are defined in `backend/src/config/networks.ts`:

```typescript
export const NETWORKS: Record<NetworkType, NetworkConfig> = {
  [NetworkType.PUBLIC]: {
    horizonUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://mainnet.stellar.org:443',
    passphrase: Networks.PUBLIC,
  },
  [NetworkType.TESTNET]: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    passphrase: Networks.TESTNET,
  },
  [NetworkType.FUTURENET]: {
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    sorobanRpcUrl: 'https://rpc-futurenet.stellar.org',
    passphrase: Networks.FUTURENET,
  },
};
```

## Asset Configuration

Assets can be configured with network-specific issuer addresses in `backend/src/config/assets.ts`:

```typescript
export const ASSETS: AssetConfig[] = [
  {
    code: 'USDC',
    issuers: {
      [NetworkType.PUBLIC]: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      [NetworkType.TESTNET]: 'GBBD47IF6LWLVNC7F7YSACOA73YI4COI3V5O2S46F7S44GUL44YQY4O2',
      [NetworkType.FUTURENET]: 'GBBD47IF6LWLVNC7F7YSACOA73YI4COI3V5O2S46F7S44GUL44YQY4O2',
    },
    // ... other asset properties
  },
];
```

## Example .env File

```bash
# Node environment
NODE_ENV=development

# Server configuration
PORT=3002

# Database
DATABASE_URL=file:./prisma/dev.db

# JWT Secret
JWT_SECRET=stellar-anchor-secret

# Stellar Network Configuration
STELLAR_NETWORK=futurenet
STELLAR_HORIZON_URL=https://horizon-futurenet.stellar.org
HORIZON_URL=https://horizon-futurenet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"

# Stellar Fee Configuration
STELLAR_BASE_FEE=100

# Interactive URL
INTERACTIVE_URL=http://localhost:3000

# Webhook Configuration (optional)
WEBHOOK_URL=http://localhost:3000/webhook
WEBHOOK_SECRET=webhook-secret
WEBHOOK_TIMEOUT_MS=5000
WEBHOOK_MAX_RETRIES=3
WEBHOOK_RETRY_DELAY_MS=500

# Indexer Configuration
INDEXER_CRON_SCHEDULE=0 * * * *
```

## Verification

To verify that all services are correctly configured for Futurenet:

1. Check the environment variables are set correctly
2. Start the backend service
3. Verify the Stellar service is using the correct network by checking logs
4. Test the Indexer service by triggering a crawl job
5. Test the Auth service by requesting a SEP-10 challenge
6. Verify the network passphrase in the challenge response matches Futurenet

## Switching Networks

To switch between networks, simply update the `STELLAR_NETWORK` environment variable and restart the backend service:

```bash
# Switch to Testnet
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Switch to Public
STELLAR_NETWORK=public
STELLAR_HORIZON_URL=https://horizon.stellar.org
HORIZON_URL=https://horizon.stellar.org
STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"

# Switch to Futurenet
STELLAR_NETWORK=futurenet
STELLAR_HORIZON_URL=https://horizon-futurenet.stellar.org
HORIZON_URL=https://horizon-futurenet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"
```

## Important Notes

- Futurenet is a test network for upcoming protocol features
- Always use testnet or futurenet for development and testing
- Never use private keys or secrets from production networks on test networks
- The network passphrase must match the network you're connecting to
- Asset issuer addresses may differ between networks
