# AnchorPoint Codebase Index

Generated from a local scan of the repository on 2026-06-23.

## Repository Shape

AnchorPoint is a mixed TypeScript and Rust monorepo for Stellar anchor workflows, Soroban smart contracts, local mock infrastructure, and deployment assets.

Top-level file counts from `rg --files`, excluding dependency/build directories:

| Area | Files | Purpose |
| --- | ---: | --- |
| `backend/` | 231 | Express API, Prisma schema, services, workers, tests, docs |
| `src/` | 59 | Root Rust workspace of Soroban contract crates and utilities |
| `contracts/` | 43 | Secondary Rust workspace of deployable/example Soroban contracts |
| `infra/` | 16 | Kubernetes, Terraform, ELK, Kibana, Logstash assets |
| `tools/` | 10 | Deterministic Horizon/Soroban mock server |
| `dashboard/` | 10 | React/Vite/Tailwind dashboard frontend |
| `demo/` | 2 | Legacy/simple mock anchor server |
| `docs/` | 3 | Focused repo-level operational docs |
| root docs/scripts | mixed | Implementation notes, merge/reconnaissance summaries, deployment script, CI |

## Main Entrypoints

| Area | Entrypoint | Notes |
| --- | --- | --- |
| Monorepo scripts | `package.json` | npm workspaces for `dashboard`, `demo`, and `backend` |
| Backend API | `backend/src/index.ts` | Express app, health check, Swagger, metrics, SEP routes, API routes |
| Backend DB | `backend/prisma/schema.prisma` | SQLite Prisma schema plus migration history |
| Dashboard | `dashboard/src/main.tsx`, `dashboard/src/App.tsx` | Single React app with dashboard, config, transaction, and SEP-24 surfaces |
| Mock server | `tools/mock-server/src/server.ts` | Express mock Horizon REST and Soroban RPC endpoints |
| Root Rust workspace | `Cargo.toml` | Contract/util crates under `src/*` |
| Contracts workspace | `contracts/Cargo.toml` | Contract crates under `contracts/*` |
| Docker stack | `docker-compose.yml` | Backend, Redis, Jaeger, Prometheus |
| CI | `.github/workflows/` | Backend, Rust, and migration integrity workflows |

## Common Commands

From the repository root:

```sh
npm run install:all
npm run dev
npm run test:backend
npm run lint:backend
npm run migrate:check
```

Backend-only:

```sh
cd backend
npm run dev
npm run build
npm test
npm run test:coverage
npm run prisma:generate
npm run prisma:migrate
npm run migrate:verify
npm run migrate:status
```

Dashboard-only:

```sh
cd dashboard
npm run dev
npm run build
npm run lint
```

Mock server:

```sh
cd tools/mock-server
npm run dev
npm run build
npm test
```

Rust workspaces:

```sh
cargo test
cargo build --release
cd contracts
cargo test
```

## Backend Index

The backend is a TypeScript Express app with Jest/Supertest coverage, Prisma/SQLite persistence, Redis-backed coordination, Swagger docs, Prometheus metrics, feature flags, notifications, and tracing support.

Backend source breakdown:

| Path | Files | Contents |
| --- | ---: | --- |
| `backend/src/api/` | 74 | Controllers, routes, and middleware |
| `backend/src/services/` | 67 | Business logic and service tests/docs |
| `backend/src/tracing/` | 9 | Tracing service, middleware, Winston format, Prisma extension |
| `backend/src/config/` | 9 | Env, networks, auth thresholds, assets, Swagger, queues, feature flags |
| `backend/src/utils/` | 9 | Logger, SEP-10 helpers, ledger offset store, log/tracing utilities |
| `backend/src/lib/` | 8 | Prisma, Redis, DB/key management, notification providers |
| `backend/src/sep31/` | 4 | SEP-31 router/service/types/validation |
| `backend/src/workers/` | 3 | Contract queue worker, recurring payments worker, fee report scheduler |
| `backend/src/test/` | 3 | Higher-level/e2e style tests |
| `backend/src/types/` | 2 | Indexer and relayer shared types |

Key directories:

| Path | Contents |
| --- | --- |
| `backend/src/api/routes/` | Express routers for admin, auth, config, events, fees, metrics, relayer, SEP flows, transactions, users |
| `backend/src/api/controllers/` | Controller layer for many route groups |
| `backend/src/api/middleware/` | Auth, API key, validation, rate limiting, metrics, tracing, request logging, error handling |
| `backend/src/services/` | Business logic: auth, Stellar, KYC, relayer, multisig, recurring payments, batch payments, fees, metrics, indexer, notifications, feature flags |
| `backend/src/services/indexer/` | SEP-1/TOML asset indexing support |
| `backend/src/lib/` | Prisma, Redis, key management, notification providers |
| `backend/src/workers/` | Background workers and scheduled jobs |
| `backend/prisma/` | Prisma schema, migrations, SQLite dev DB |
| `backend/scripts/` | Migration verification, integrity checking, rollback generation |
| `backend/docs/` | Feature flags, migration integrity, key management, task queue, multisig, SEP-40, Soroban error handling |

Mounted routes in `backend/src/index.ts`:

| Mount | Router |
| --- | --- |
| `/` | Root text response |
| `/health` | Health check |
| `/api-docs`, `/api-docs.json` | Swagger UI and JSON |
| `/api/transactions` | `transactions.route.ts` |
| `/api/admin` | `admin.route.ts` |
| `/api/config` | `config.route.ts` |
| `/api/reports` | `fee-report.route.ts` |
| `/api/events` | `event.route.ts` |
| `/api/notifications` | `notifications.route.ts` |
| `/api/relayer` | `relayer.route.ts` |
| `/api/recurring-payments` | `recurring-payments.route.ts` |
| `/metrics` | `metrics.route.ts` |
| `/sep6` | `sep6.route.ts` |
| `/sep24` | `sep24.route.ts` |
| `/sep38` | `sep38.route.ts` |
| `/sep40` | `sep40.route.ts` |
| `/info` | `info.route.ts` |

Important backend services:

| Service | Responsibility |
| --- | --- |
| `auth.service.ts` | SEP-10/JWT auth, challenge storage, multi-key auth helpers |
| `stellar.service.ts` | Stellar account/signature/transaction operations |
| `kyc.service.ts`, `kyc-provider.service.ts` | SEP-12/KYC flow helpers and provider adapters |
| `sep31.service.ts`, `sep31CallbackNotifier.ts` | SEP-31 transaction lifecycle and callbacks |
| `relayer.service.ts` | Gasless approval/relayer workflows |
| `multisig.service.ts` | Multisig coordination |
| `recurring-payments.service.ts` | Recurring payment schedules and runs |
| `batch-payment.service.ts` | Batch/chunked payments and retry helpers |
| `fee.service.ts`, `fee-report.service.ts` | Fee estimation, stats, reporting |
| `price-aggregation.service.ts` | Horizon/exchange price aggregation |
| `event-indexer.service.ts` | Event indexing |
| `feature-flag.service.ts` | Feature flag evaluation |
| `advanced-cache.service.ts`, `redis.service.ts` | Cache and Redis abstractions |
| `contract-queue.service.ts` | Contract job queue orchestration |
| `hot-wallet-monitor.service.ts` | Hot wallet health/threshold checks |
| `soroban-error.service.ts` | Soroban error interpretation |

Prisma schema inventory:

Models: `User`, `AdminUser`, `AdminPasswordResetToken`, `ApiKey`, `RecurringPaymentSchedule`, `RecurringPaymentRun`, `Transaction`, `FeeReport`, `NotificationPreference`, `Notification`, `KycCustomer`, `SystemConfig`, `ContractJob`.

Enums: `Tier`, `RecurringPaymentScheduleStatus`, `RecurringPaymentRunStatus`, `NotificationType`, `NotificationStatus`, `KYCStatus`, `JobStatus`, `JobPriority`.

## Dashboard Index

The dashboard is a Vite React app using TypeScript, Tailwind CSS, Framer Motion, Lucide icons, Axios, and Stellar SDK.

Key files:

| Path | Purpose |
| --- | --- |
| `dashboard/src/App.tsx` | Main app, navigation, dashboard overview, transaction table, SEP-24 flow, config-driven branding |
| `dashboard/src/main.tsx` | React mount |
| `dashboard/src/index.css` | Tailwind and theme variables |
| `dashboard/vite.config.ts` | Vite configuration |
| `dashboard/tailwind.config.js` | Tailwind configuration |

The frontend defaults API calls to `http://localhost:3002` unless `VITE_API_BASE_URL` is set.

## Root Rust Workspace Index

The root `Cargo.toml` workspace contains contract and support crates under `src/`:

`amm`, `auth`, `batch`, `bridge`, `circuit_breaker`, `escrow_multisig`, `escrow_timelock`, `event_hub`, `flash_loan`, `governance`, `indexing`, `kyc`, `liquidation`, `oracle_consumer`, `oracle_medianizer`, `proxy`, `random`, `security_registry`, `staking`, `token`, `upgradeable`, `utils`, `vesting`, `yield_farming`, `benchmarks`.

Notable root workspace crates:

| Crate | Main focus |
| --- | --- |
| `src/amm` | AMM logic and pool pause behavior |
| `src/auth` | Auth/RBAC logic |
| `src/batch` | Batch executor contract |
| `src/bridge` | Bridge-related logic |
| `src/circuit_breaker` | Circuit breaker contract |
| `src/escrow_multisig` | Multisig escrow behavior |
| `src/escrow_timelock` | Timelocked escrow behavior |
| `src/event_hub` | Event hub contract and README |
| `src/flash_loan` | Flash loan provider with tests/verification |
| `src/governance` | Proposal/vote/execution governance |
| `src/indexing` | Optimized indexing crate |
| `src/kyc` | KYC contract logic |
| `src/liquidation` | Liquidation contract logic |
| `src/oracle_consumer`, `src/oracle_medianizer` | Oracle price consumption/medianization |
| `src/proxy` | Proxy contract logic |
| `src/random` | Commit/reveal random number generation |
| `src/security_registry` | Pause/security registry |
| `src/staking` | Staking plus snapshot module |
| `src/token` | Fungible and semi-fungible token behavior |
| `src/upgradeable` | Multisig upgrade proposal workflow |
| `src/utils` | Shared metadata, fees, events, contract-to-contract helpers |
| `src/vesting` | Vesting logic |
| `src/yield_farming` | Yield farming contract |
| `src/benchmarks` | Benchmark support crate |

## Contracts Workspace Index

The `contracts/` workspace uses `soroban-sdk = 22.0.0` and includes:

| Crate | Main focus |
| --- | --- |
| `contracts/anchorpoint` | Admin/rate-limit/storage-key helpers |
| `contracts/bridge_stub` | Burn/mint bridge stub with relayer controls |
| `contracts/governance` | Governance contract and state-machine/fuzz/storage tests |
| `contracts/liquid_staking` | Liquid staking with NFT-like metadata/stake info |
| `contracts/nft_metadata` | NFT metadata contract |
| `contracts/random_gen` | Simpler commit/reveal random generation |
| `contracts/reentrancy-guard` | Guard utility, examples, README, security guide |
| `contracts/registry` | Contract registry with active/paused/admin state |
| `contracts/revenue_distributor` | Revenue distribution and AMM sweep |
| `contracts/staking` | Multi-token staking rewards |
| `contracts/swap` | Multi-asset concentrated-liquidity style swap |
| `contracts/xlm_wrapper` | Wrapped XLM token behavior with auth/pause hooks |
| `contracts/yield` | Yield distribution/staking rewards |

## Mock Server And Demo

`tools/mock-server` is a deterministic Express server for local Stellar integrations:

| Path | Purpose |
| --- | --- |
| `tools/mock-server/src/server.ts` | Starts Horizon REST and Soroban RPC listeners |
| `tools/mock-server/src/horizon/routes.ts` | Horizon REST mocks |
| `tools/mock-server/src/soroban/routes.ts` | Soroban JSON-RPC mocks |
| `tools/mock-server/src/scenarios/` | Scenario selection and delays |
| `tools/mock-server/src/ledger-state/` | Fixture-backed ledger state |
| `tools/mock-server/fixtures/` | Mock ledger fixtures |

`demo/server.js` is the older mock anchor server used by the dashboard README flow.

## Infrastructure Index

| Path | Purpose |
| --- | --- |
| `docker-compose.yml` | Backend, Redis, Jaeger, Prometheus |
| `prometheus.yml` | Prometheus scrape configuration |
| `infra/k8s/workers/` | Worker deployment manifests |
| `infra/k8s/cert-manager/` | cert-manager values, issuers, certificates, ingress annotations |
| `infra/terraform/rds/` | RDS Terraform module/example vars |
| `infra/elasticsearch/watchers/` | Error-rate and latency watchers |
| `infra/logstash/pipeline.conf` | Logstash pipeline |
| `infra/kibana/dashboard.ndjson` | Kibana dashboard export |

## Documentation Index

High-signal docs at the repo root and below:

| Path | Topic |
| --- | --- |
| `README.md` | Overall AnchorPoint dashboard/backend overview |
| `backend/README.md` | Backend setup, tests, KYC providers, password reset |
| `TRACING_README.md` | Tracing guidance |
| `docs/mock-server.md` | Mock server usage |
| `docs/rate-limiting.md` | Rate limiting |
| `docs/testing-governance.md` | Governance testing |
| `backend/docs/FEATURE_FLAGS.md` | Feature flags |
| `backend/docs/KEY_MANAGEMENT.md` | Key management |
| `backend/docs/MIGRATION_INTEGRITY.md` | Migration integrity checks |
| `backend/docs/MULTISIG_COORDINATION.md` | Multisig coordination |
| `backend/docs/TASK_QUEUE.md` | Task queue |
| `backend/docs/SEP40_SWAP_RATES.md` | SEP-40 support |
| `backend/docs/SOROBAN_ERROR_HANDLING.md` | Soroban error handling |
| `backend/RELAYER_GASLESS_ONBOARDING.md` | Relayer onboarding |
| `backend/FUTURENET_CONFIGURATION.md` | Futurenet configuration |
| `backend/MULTISIG_SETUP.md` | Multisig setup |
| `contracts/reentrancy-guard/README.md` | Reentrancy guard usage |
| `contracts/reentrancy-guard/SECURITY_GUIDE.md` | Reentrancy security guidance |
| `contracts/registry/README.md` | Registry contract usage |
| `contracts/swap/README.md` | Swap contract usage |
| `contracts/xlm_wrapper/README.md` | XLM wrapper contract usage |

## Watch Points From The Scan

These are not fixed by this index, but they are worth checking before running builds or migrations:

1. `backend/src/index.ts` has duplicate imports for `errorHandler`, `metricsMiddleware`, and `connectionTracker`.
2. `backend/src/index.ts` mounts some public routers twice, once directly and once behind `publicLimiter`.
3. `backend/src/index.ts` appears to call `app.listen(PORT, ...)` twice when `NODE_ENV !== "test"`.
4. `backend/package.json` lists `node-cron` twice with different versions.
5. `backend/prisma/schema.prisma` should be validated with `npm run prisma:generate` or `npm run migrate:check` before schema work.

## Quick Orientation For Future Changes

Use this routing pattern for backend work:

1. Start at the route in `backend/src/api/routes/`.
2. Follow to a controller in `backend/src/api/controllers/` if present.
3. Follow business logic into `backend/src/services/`.
4. Check persistence in `backend/prisma/schema.prisma` and migrations.
5. Check tests colocated beside routes/services or under `backend/src/test/`.

Use this pattern for contract work:

1. Identify the workspace: root `src/*` or `contracts/*`.
2. Inspect the crate `Cargo.toml`.
3. Read the crate `lib.rs` and any `tests` modules.
4. Prefer existing shared utilities in `src/utils` and established security patterns such as `security_registry`, `circuit_breaker`, and `reentrancy-guard`.

Use this pattern for dashboard work:

1. Start at `dashboard/src/App.tsx`.
2. Check API assumptions against `VITE_API_BASE_URL` and backend routes.
3. Keep styling aligned with `dashboard/src/index.css` and Tailwind config.

