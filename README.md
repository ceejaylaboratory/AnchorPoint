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
- The user signs it with their wallet (e.g., Freight, Albedo, or Rabe).
- The dashboard submits the signed transaction to get a JWT.

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
