# Project Documentation

This directory contains operational, security, deployment, and quality documentation for AnchorPoint.

## Architectural Decisions

- Production deployment guidance is kept separate from testnet architecture notes so operators do not mistake testnet defaults for production controls.
- The production runbook is grounded in the AWS KMS, RDS, Prisma, Stellar, and Prometheus configuration already present in the repository.
- Secrets are described by name, ownership, and injection path only. Secret values remain outside source control and documentation.

## Files

- [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) contains the production launch checklist, environment contract, security gates, monitoring setup, and incident response procedures.
- [`TESTNET_DEPLOYMENT_ARCHITECTURE.md`](./TESTNET_DEPLOYMENT_ARCHITECTURE.md) describes the existing testnet service topology and request flow.
- [`security-audit.md`](./security-audit.md) documents the contract security audit process.
- [`TRACING_README.md`](./TRACING_README.md) documents tracing configuration and validation.
- [`SSE_WEBSOCKET_CLEANUP.md`](./SSE_WEBSOCKET_CLEANUP.md) documents SSE/Socket.IO disconnect cleanup and connection gauges.
- [`DATABASE_POOL_RECOVERY.md`](./DATABASE_POOL_RECOVERY.md) documents Prisma keepalive settings, health probes, and automatic reconnects.

## Logic Tracking

To find the production launch sequence visit [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).

To find the contract security audit process visit [security-audit.md](./security-audit.md).

## Component and Connection References

The AWS KMS connection can be found in [infra/terraform/kms/main.tf](../infra/terraform/kms/main.tf).

The PostgreSQL connection can be found in [infra/terraform/rds/main.tf](../infra/terraform/rds/main.tf).

The monitoring connection can be found in [infra/monitoring/README.md](../infra/monitoring/README.md).
