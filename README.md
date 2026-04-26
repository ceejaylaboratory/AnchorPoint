# AnchorPoint: Standardized Stellar Anchor Dashboard

AnchorPoint is a premium, developer-first dashboard template designed for Stellar Anchors. It provides a standardized UI for implementing Stellar Ecosystem Proposals (SEPs), specifically focusing on SEP-24 (Interactive Self-Contained Deposits and Withdrawals).

## Project Structure

This is a monorepo containing:
- `/dashboard`: A React/Vite frontend built with TypeScript, Tailwind CSS, and Framer Motion.
- `/demo`: A mock anchor server to simulate SEP responses for local development and testing.

## Key Features

- **SEP-24 Wizard**: A multi-step UI flow for handling deposits and withdrawals.
- **Transaction Management**: A detailed view of pending and historical transactions.
- **Interactive KYC**: Placeholder integration for SEP-12 interactive flows.
- **Institutional Branding**: Easily customizable via CSS variables.

## Implementation Guide: Stellar Ecosystem Proposals (SEPs)

### 1. SEP-1: stellar.toml
The entry point for any anchor. It defines the supported assets and the URLs for other SEPs.
- Place your `stellar.toml` in `/.well-known/stellar.toml`.
- Ensure CORS is enabled on your server.

### 2. SEP-10: Stellar Web Authentication
Before initiating transactions, the dashboard must authenticate the user's wallet.
- The dashboard requests a challenge transaction from the anchor.
- The user signs it with their wallet (e.g., Freight, Albedo, Rabe, **Trezor, or Ledger**).
- The dashboard submits the signed transaction to get a JWT.

**Hardware Wallet Support**: AnchorPoint now supports hardware wallets (Trezor, Ledger) for SEP-10 authentication. The backend generates proper Stellar transactions with manage_data operations containing the challenge, which hardware wallets can sign using their secure elements. This ensures compatibility with hardware wallets that require specific transaction structures and signature algorithms.

### 3. SEP-24: Interactive Flows
The core of AnchorPoint. 
- **Deposit**: Request `/transactions/deposit/interactive`. The anchor returns a URL to a webview.
- **Withdraw**: Request `/transactions/withdraw/interactive`. Similar to deposit, but requires a subsequent transaction to the anchor's distribution account.

### 4. SEP-12: KYC
Standardized way to collect user information.
- Interactive KYC (supported by AnchorPoint) allows the anchor to provide a URL for complex data collection (documents, biometrics).

## Customization

 instituciones can change the branding by modifying `/dashboard/src/index.css`:

```css
:root {
  --primary: #0052FF;
  --primary-foreground: #FFFFFF;
  --accent: #7928CA;
  --background: #000000;
  --card: #111111;
}
```

## Getting Started

1. **Install dependencies**:
   ```bash
   npm run install:all
   ```

2. **Run the project**:
   ```bash
   npm run dev
   ```

3. **Explore the Demo**:
   The dashboard is pre-configured to point to the local mock anchor server running on port 3001.

## Docker Setup

Quickly deploy the backend with all dependencies using Docker Compose.

### Prerequisites
- Docker (v20+)
- Docker Compose (v2.0+)

### Quick Start

```bash
# Start all services (backend, Redis, SQLite)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Services

| Service   | Port | Description                    |
|-----------|------|--------------------------------|
| Backend   | 3002 | Node.js/TypeScript API server  |
| Redis     | 6379 | Cache and session store        |

### Health Check

Verify the backend is running:

```bash
curl http://localhost:3002/health
```

### Data Persistence

Data is stored in Docker volumes:
- `backend-data`: SQLite database
- `redis-data`: Redis data

To remove volumes along with containers:

```bash
docker-compose down -v
```

### Development

For local development without Docker, see the [Backend README](./backend/README.md).

## Testing

### End-to-End Test Suite

The project includes a comprehensive end-to-end test suite that simulates a complete cross-border payment flow, including:

- **SEP-10 Authentication**: Challenge generation and signature verification (mocked for testing)
- **SEP-12 KYC Submission**: Customer information upload and status tracking
- **SEP-31 Cross-Border Payments**: Transaction creation, status updates, and settlement
- **SEP-38 Quotes**: Price discovery and quote generation
- **SEP-24 Deposits/Withdrawals**: Interactive deposit and withdrawal flows

#### Running E2E Tests

```bash
# Ensure Docker services are running
docker-compose up -d

# Run the full E2E test suite
cd backend
npm run test:e2e

# Run SEP-31 specific cross-border payment tests
npm run test:sep31
```

#### Test Coverage

The E2E test suite covers:

1. **SEP-1 Info**: Stellar.toml configuration and asset discovery
2. **SEP-10 Auth**: Challenge-response authentication flow (mocked)
3. **SEP-12 KYC**: Customer information submission and webhook updates
4. **SEP-31 Payments**: Full cross-border payment lifecycle from creation to settlement
5. **SEP-38 Quotes**: Firm quote generation with external price feeds
6. **SEP-24 Interactive**: Deposit/withdrawal flow initiation
7. **Complete Flow Integration**: End-to-end flow from KYC submission through final settlement

#### Test Flow Example

```typescript
// 1. SEP-10 Authentication (Mocked for testing)
const authToken = 'mock-jwt-token-for-e2e-testing';

// 2. SEP-12 KYC Submission
const kycRes = await request(app)
  .put('/sep12/customer')
  .set('Authorization', `Bearer ${authToken}`)
  .field('account', clientPublicKey)
  .field('first_name', 'John')
  .field('last_name', 'Doe');

// 3. SEP-38 Quote Generation
const quoteRes = await request(app)
  .post('/sep38/quote')
  .set('Authorization', `Bearer ${authToken}`)
  .send({
    source_asset: 'USDC',
    source_amount: '100',
    destination_asset: 'XLM'
  });

// 4. SEP-31 Transaction Creation
const transaction = await request(app)
  .post('/sep31/transactions')
  .set('Authorization', `Bearer ${authToken}`)
  .send({
    asset_code: 'USDC',
    amount: '100.00',
    sender_info: { /* KYC data */ },
    receiver_info: { /* KYC data */ }
  });

// 5. Status Updates and Settlement
await request(app)
  .patch(`/api/admin/transactions/${transaction.id}`)
  .send({
    status: 'completed',
    stellar_transaction_id: 'tx_123',
    external_transaction_id: 'bank_tx_456',
    amount_out: '99.50',
    amount_fee: '0.50'
  });
```

The test suite ensures compliance with Stellar Ecosystem Proposals and validates the complete user journey from authentication to final settlement, including proper callback handling and status transitions.
