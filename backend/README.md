# AnchorPoint Backend

The backend service for AnchorPoint, providing API endpoints for Stellar Anchor operations as per SEPs 1, 10, 12, and 24.

## Tech Stack
- **Node.js**: Runtime environment.
- **TypeScript**: Typed JavaScript for robustness.
- **Express**: Fast, unopinionated, minimalist web framework.
- **Jest & Supertest**: Testing framework and HTTP assertion library.
- **ESLint**: Linter for identifying and reporting on patterns in JavaScript/TypeScript.

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm

### Installation
From the monorepo root:
```bash
npm run install:all
```

Or from the `/backend` directory:
```bash
npm install
```

### Development
To start the development server with auto-reload:
```bash
npm run dev
```

### Building
To compile TypeScript to JavaScript:
```bash
npm run build
```

### Testing
To run tests:
```bash
npm test
```

To run tests with coverage report:
```bash
npm run test:coverage
```

Current coverage threshold is set to **95%** for branches, functions, lines, and statements.

### Quality Control
To run the linter:
```bash
npm run lint
```

## External KYC Providers (SEP-12)
AnchorPoint supports pluggable third-party KYC providers for SEP-12 flows.

Supported providers:
- `mock` (default)
- `persona`
- `shufti`

Configuration:
- `KYC_PROVIDER=mock|persona|shufti`
- `KYC_WEBHOOK_SECRET=<shared secret for webhook signature validation>`
- `PERSONA_API_KEY=<persona api key>`
- `PERSONA_API_URL=<optional, defaults to https://withpersona.com/api/v1>`
- `SHUFTI_CLIENT_ID=<shufti client id>`
- `SHUFTI_SECRET_KEY=<shufti secret key>`
- `SHUFTI_API_URL=<optional, defaults to https://api.shuftipro.com>`

Webhook endpoint:
- `POST /sep12/webhook`

Provider webhook updates are validated by signature and then reconciled against either provider reference or account.
